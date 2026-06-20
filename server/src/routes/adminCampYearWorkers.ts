import prismaClientPkg, { type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, CheckInStatus, DormPurpose, Gender, ImportSource } = prismaClientPkg;

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
    email: z.union([z.literal(""), z.string().email()]),
    cellPhone: z.string(),
    streetAddress: z.string(),
    city: z.string(),
    stateOrProvince: z.string(),
    postalCode: z.string(),
    country: z.string(),
    checkInStatus: z.nativeEnum(CheckInStatus).optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .partial();

const convertToDormLeaderBody = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  gender: z.nativeEnum(Gender).optional(),
  email: z.union([z.literal(""), z.string().email()]).optional(),
  phone: z.string().optional(),
  roleLabel: z.string().nullable().optional(),
  assignedCamperDormId: z.string().uuid().nullable().optional(),
});

async function assertDormForWorkerYear(
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

router.post("/", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
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

  const dormCheck = await assertDormForWorkerYear(campYearId, parsed.data.dormId ?? null);
  if (!dormCheck.ok) {
    res.status(dormCheck.status).json({ error: dormCheck.message });
    return;
  }

  const dob = parsed.data.dateOfBirth
    ? new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`)
    : null;

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
    const dormCheck = await assertDormForWorkerYear(campYearId, parsed.data.dormId ?? null);
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

  const updated = await prisma.worker.update({
    where: { id: workerId },
    data,
  });
  res.json(updated);
});

router.post(
  "/:workerId/convert-to-dorm-leader",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const workerId = pathParam(req.params.workerId);
    if (!workerId || !z.string().uuid().safeParse(workerId).success) {
      res.status(400).json({ error: "Invalid worker id" });
      return;
    }
    const parsed = convertToDormLeaderBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const worker = await prisma.worker.findFirst({
      where: { id: workerId, campYearId, archivedAt: null },
    });
    if (!worker) {
      res.status(404).json({ error: "Worker not found" });
      return;
    }

    const assignedDorm = worker.dormId
      ? await prisma.dorm.findFirst({
          where: { id: worker.dormId, campYearId },
          select: { id: true, purpose: true },
        })
      : null;
    const targetDormId =
      parsed.data.assignedCamperDormId !== undefined
        ? parsed.data.assignedCamperDormId
        : assignedDorm?.purpose === DormPurpose.camper
          ? assignedDorm.id
          : null;
    if (targetDormId) {
      const targetDorm = await prisma.dorm.findFirst({
        where: { id: targetDormId, campYearId, purpose: DormPurpose.camper },
        select: { id: true },
      });
      if (!targetDorm) {
        res.status(400).json({ error: "Dorm leader assignment must reference a camper dorm" });
        return;
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const dormLeader = await tx.dormLeader.create({
        data: {
          campYearId,
          firstName: parsed.data.firstName?.trim() ?? worker.firstName,
          lastName: parsed.data.lastName?.trim() ?? worker.lastName,
          gender: parsed.data.gender ?? worker.gender,
          email: parsed.data.email?.trim().toLowerCase() ?? worker.email,
          phone: parsed.data.phone?.trim() ?? worker.cellPhone,
          roleLabel: parsed.data.roleLabel?.trim() ?? null,
          assignedCamperDormId: targetDormId,
          checkInStatus: worker.checkInStatus,
          checkedInAt: worker.checkedInAt,
          importSource: worker.importSource,
        },
      });
      await tx.worker.update({
        where: { id: workerId },
        data: { archivedAt: new Date(), dormId: null },
      });
      return dormLeader;
    });

    writeOpsLog("worker_converted_to_dorm_leader", {
      adminUserId: req.adminUser?.id,
      campYearId,
      workerId,
      dormLeaderId: created.id,
    });
    res.status(201).json(created);
  },
);

router.delete("/:workerId", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const workerId = pathParam(req.params.workerId);
  if (!workerId || !z.string().uuid().safeParse(workerId).success) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }

  const result = await prisma.worker.updateMany({
    where: { id: workerId, campYearId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  writeOpsLog("worker_deleted", {
    adminUserId: req.adminUser?.id,
    campYearId,
    workerId,
  });
  res.status(204).send();
});

export const adminCampYearWorkersRouter = router;
