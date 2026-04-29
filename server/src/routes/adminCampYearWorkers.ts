import {
  AdminRole,
  CheckInStatus,
  DormPurpose,
  Gender,
  ImportSource,
  type Prisma,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const workerBody = {
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: isoDateString.nullable().optional(),
  gender: z.nativeEnum(Gender),
  cellPhone: z.string().min(1),
  altPhone: z.string().nullable().optional(),
  streetAddress: z.string().min(1),
  city: z.string().min(1),
  stateOrProvince: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  taskPreferenceFirst: z.string().nullable().optional(),
  taskPreferenceSecond: z.string().nullable().optional(),
  taskPreferenceThird: z.string().nullable().optional(),
  tShirtSize: z.string().nullable().optional(),
  dormId: z.string().uuid().nullable().optional(),
};

const createBody = z.object(workerBody);

const updateBody = z
  .object({
    ...workerBody,
    checkInStatus: z.nativeEnum(CheckInStatus).optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .partial();

async function assertWorkerDormForYear(
  campYearId: string,
  dormId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!dormId) {
    return { ok: true };
  }
  const dorm = await prisma.dorm.findFirst({
    where: { id: dormId, campYearId },
    select: { purpose: true },
  });
  if (!dorm) {
    return { ok: false, status: 400, message: "Dorm not found for this camp year" };
  }
  if (dorm.purpose !== DormPurpose.worker) {
    return { ok: false, status: 400, message: "Worker dorm assignment must reference a worker dorm" };
  }
  return { ok: true };
}

router.get("/", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }
  const workers = await prisma.worker.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  res.json({ workers });
});

router.post("/", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const campYear = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const dormCheck = await assertWorkerDormForYear(campYearId, parsed.data.dormId ?? null);
  if (!dormCheck.ok) {
    res.status(dormCheck.status).json({ error: dormCheck.message });
    return;
  }

  const dob = parsed.data.dateOfBirth
    ? new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`)
    : null;

  try {
    const created = await prisma.worker.create({
      data: {
        campYearId,
        email: parsed.data.email.trim().toLowerCase(),
        firstName: parsed.data.firstName.trim(),
        lastName: parsed.data.lastName.trim(),
        dateOfBirth: dob,
        gender: parsed.data.gender,
        cellPhone: parsed.data.cellPhone.trim(),
        altPhone: parsed.data.altPhone?.trim() ?? null,
        streetAddress: parsed.data.streetAddress.trim(),
        city: parsed.data.city.trim(),
        stateOrProvince: parsed.data.stateOrProvince.trim(),
        postalCode: parsed.data.postalCode.trim(),
        country: parsed.data.country.trim(),
        taskPreferenceFirst: parsed.data.taskPreferenceFirst?.trim() ?? null,
        taskPreferenceSecond: parsed.data.taskPreferenceSecond?.trim() ?? null,
        taskPreferenceThird: parsed.data.taskPreferenceThird?.trim() ?? null,
        tShirtSize: parsed.data.tShirtSize?.trim() ?? null,
        dormId: parsed.data.dormId ?? null,
        importSource: ImportSource.admin_entry,
      },
    });
    res.status(201).json(created);
  } catch {
    res.status(409).json({ error: "A worker with this email already exists for this camp year" });
  }
});

router.get("/:workerId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const workerId = pathParam(req.params.workerId);
  if (!workerId || !z.string().uuid().safeParse(workerId).success) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, campYearId },
  });
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }
  res.json(worker);
});

router.patch("/:workerId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const workerId = pathParam(req.params.workerId);
  if (!workerId || !z.string().uuid().safeParse(workerId).success) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const existing = await prisma.worker.findFirst({
    where: { id: workerId, campYearId },
  });
  if (!existing) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  if (parsed.data.dormId !== undefined) {
    const dormCheck = await assertWorkerDormForYear(campYearId, parsed.data.dormId ?? null);
    if (!dormCheck.ok) {
      res.status(dormCheck.status).json({ error: dormCheck.message });
      return;
    }
  }

  const data: Prisma.WorkerUpdateInput = {};
  const partial = parsed.data;
  if (partial.email !== undefined) {
    data.email = partial.email.trim().toLowerCase();
  }
  if (partial.firstName !== undefined) {
    data.firstName = partial.firstName.trim();
  }
  if (partial.lastName !== undefined) {
    data.lastName = partial.lastName.trim();
  }
  if (partial.dateOfBirth !== undefined) {
    data.dateOfBirth =
      partial.dateOfBirth === null ? null : new Date(`${partial.dateOfBirth}T12:00:00.000Z`);
  }
  if (partial.gender !== undefined) {
    data.gender = partial.gender;
  }
  if (partial.cellPhone !== undefined) {
    data.cellPhone = partial.cellPhone.trim();
  }
  if (partial.altPhone !== undefined) {
    data.altPhone = partial.altPhone?.trim() ?? null;
  }
  if (partial.streetAddress !== undefined) {
    data.streetAddress = partial.streetAddress.trim();
  }
  if (partial.city !== undefined) {
    data.city = partial.city.trim();
  }
  if (partial.stateOrProvince !== undefined) {
    data.stateOrProvince = partial.stateOrProvince.trim();
  }
  if (partial.postalCode !== undefined) {
    data.postalCode = partial.postalCode.trim();
  }
  if (partial.country !== undefined) {
    data.country = partial.country.trim();
  }
  if (partial.taskPreferenceFirst !== undefined) {
    data.taskPreferenceFirst = partial.taskPreferenceFirst?.trim() ?? null;
  }
  if (partial.taskPreferenceSecond !== undefined) {
    data.taskPreferenceSecond = partial.taskPreferenceSecond?.trim() ?? null;
  }
  if (partial.taskPreferenceThird !== undefined) {
    data.taskPreferenceThird = partial.taskPreferenceThird?.trim() ?? null;
  }
  if (partial.tShirtSize !== undefined) {
    data.tShirtSize = partial.tShirtSize?.trim() ?? null;
  }
  if (partial.dormId !== undefined) {
    data.dorm = partial.dormId ? { connect: { id: partial.dormId } } : { disconnect: true };
  }
  if (partial.checkInStatus !== undefined) {
    data.checkInStatus = partial.checkInStatus;
    if (
      partial.checkInStatus === CheckInStatus.checked_in &&
      existing.checkInStatus !== CheckInStatus.checked_in
    ) {
      data.checkedInAt = new Date();
    }
    if (partial.checkInStatus === CheckInStatus.not_checked_in) {
      data.checkedInAt = null;
    }
  }
  if (partial.archivedAt !== undefined) {
    data.archivedAt = partial.archivedAt ? new Date(partial.archivedAt) : null;
  }

  try {
    const updated = await prisma.worker.update({
      where: { id: workerId },
      data,
    });
    res.json(updated);
  } catch {
    res.status(409).json({ error: "A worker with this email already exists for this camp year" });
  }
});

export const adminCampYearWorkersRouter = router;
