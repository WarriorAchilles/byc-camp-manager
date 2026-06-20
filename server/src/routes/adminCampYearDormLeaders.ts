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

const leaderBody = {
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.nativeEnum(Gender),
  email: z.string().email(),
  phone: z.string().min(1),
  roleLabel: z.string().nullable().optional(),
  assignedCamperDormId: z.string().uuid().nullable().optional(),
};

const createBody = z.object(leaderBody);

const updateBody = z
  .object({
    ...leaderBody,
    email: z.union([z.literal(""), z.string().email()]),
    phone: z.string(),
    checkInStatus: z.nativeEnum(CheckInStatus).optional(),
    archivedAt: z.string().datetime().nullable().optional(),
  })
  .partial();

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const convertToWorkerBody = z.object({
  email: z.union([z.literal(""), z.string().email()]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: isoDateString.nullable().optional(),
  gender: z.nativeEnum(Gender),
  cellPhone: z.string(),
  altPhone: z.string().nullable().optional(),
  streetAddress: z.string(),
  city: z.string(),
  stateOrProvince: z.string(),
  postalCode: z.string(),
  country: z.string(),
  taskPreferenceFirst: z.string().nullable().optional(),
  taskPreferenceSecond: z.string().nullable().optional(),
  taskPreferenceThird: z.string().nullable().optional(),
  tShirtSize: z.string().nullable().optional(),
  dormId: z.string().uuid().nullable().optional(),
});

async function assertCamperDormForLeader(
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
  if (dorm.purpose !== DormPurpose.camper) {
    return {
      ok: false,
      status: 400,
      message: "Dorm leader assignment must reference a camper dorm",
    };
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
  const dormLeaders = await prisma.dormLeader.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      assignedCamperDorm: { select: { id: true, name: true } },
    },
  });
  res.json({ dormLeaders });
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

  const dormCheck = await assertCamperDormForLeader(campYearId, parsed.data.assignedCamperDormId ?? null);
  if (!dormCheck.ok) {
    res.status(dormCheck.status).json({ error: dormCheck.message });
    return;
  }

  const created = await prisma.dormLeader.create({
    data: {
      campYearId,
      firstName: parsed.data.firstName.trim(),
      lastName: parsed.data.lastName.trim(),
      gender: parsed.data.gender,
      email: parsed.data.email.trim().toLowerCase(),
      phone: parsed.data.phone.trim(),
      roleLabel: parsed.data.roleLabel?.trim() ?? null,
      assignedCamperDormId: parsed.data.assignedCamperDormId ?? null,
      importSource: ImportSource.admin_entry,
    },
  });
  res.status(201).json(created);
});

router.get("/:dormLeaderId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormLeaderId = pathParam(req.params.dormLeaderId);
  if (!dormLeaderId || !z.string().uuid().safeParse(dormLeaderId).success) {
    res.status(400).json({ error: "Invalid dorm leader id" });
    return;
  }
  const leader = await prisma.dormLeader.findFirst({
    where: { id: dormLeaderId, campYearId },
  });
  if (!leader) {
    res.status(404).json({ error: "Dorm leader not found" });
    return;
  }
  res.json(leader);
});

router.patch("/:dormLeaderId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormLeaderId = pathParam(req.params.dormLeaderId);
  if (!dormLeaderId || !z.string().uuid().safeParse(dormLeaderId).success) {
    res.status(400).json({ error: "Invalid dorm leader id" });
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const existing = await prisma.dormLeader.findFirst({
    where: { id: dormLeaderId, campYearId },
  });
  if (!existing) {
    res.status(404).json({ error: "Dorm leader not found" });
    return;
  }

  if (parsed.data.assignedCamperDormId !== undefined) {
    const dormCheck = await assertCamperDormForLeader(campYearId, parsed.data.assignedCamperDormId ?? null);
    if (!dormCheck.ok) {
      res.status(dormCheck.status).json({ error: dormCheck.message });
      return;
    }
  }

  const data: Prisma.DormLeaderUpdateInput = {};
  const partial = parsed.data;
  if (partial.firstName !== undefined) {
    data.firstName = partial.firstName.trim();
  }
  if (partial.lastName !== undefined) {
    data.lastName = partial.lastName.trim();
  }
  if (partial.gender !== undefined) {
    data.gender = partial.gender;
  }
  if (partial.email !== undefined) {
    data.email = partial.email.trim().toLowerCase();
  }
  if (partial.phone !== undefined) {
    data.phone = partial.phone.trim();
  }
  if (partial.roleLabel !== undefined) {
    data.roleLabel = partial.roleLabel?.trim() ?? null;
  }
  if (partial.assignedCamperDormId !== undefined) {
    data.assignedCamperDorm = partial.assignedCamperDormId
      ? { connect: { id: partial.assignedCamperDormId } }
      : { disconnect: true };
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

  const updated = await prisma.dormLeader.update({
    where: { id: dormLeaderId },
    data,
  });
  res.json(updated);
});

router.post(
  "/:dormLeaderId/convert-to-worker",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) return;
    const dormLeaderId = pathParam(req.params.dormLeaderId);
    if (!dormLeaderId || !z.string().uuid().safeParse(dormLeaderId).success) {
      res.status(400).json({ error: "Invalid dorm leader id" });
      return;
    }
    const parsed = convertToWorkerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const leader = await prisma.dormLeader.findFirst({
      where: { id: dormLeaderId, campYearId, archivedAt: null },
    });
    if (!leader) {
      res.status(404).json({ error: "Dorm leader not found" });
      return;
    }
    if (parsed.data.dormId) {
      const dorm = await prisma.dorm.findFirst({
        where: { id: parsed.data.dormId, campYearId },
        select: { id: true },
      });
      if (!dorm) {
        res.status(400).json({ error: "Dorm not found for this camp year" });
        return;
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const worker = await tx.worker.create({
        data: {
          campYearId,
          email: parsed.data.email.trim().toLowerCase(),
          firstName: parsed.data.firstName.trim(),
          lastName: parsed.data.lastName.trim(),
          dateOfBirth: parsed.data.dateOfBirth
            ? new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`)
            : null,
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
          checkInStatus: leader.checkInStatus,
          checkedInAt: leader.checkedInAt,
          importSource: leader.importSource,
        },
      });
      await tx.dormLeader.update({
        where: { id: dormLeaderId },
        data: { archivedAt: new Date(), assignedCamperDormId: null },
      });
      return worker;
    });

    writeOpsLog("dorm_leader_converted_to_worker", {
      adminUserId: req.adminUser?.id,
      campYearId,
      dormLeaderId,
      workerId: created.id,
    });
    res.status(201).json(created);
  },
);

router.delete(
  "/:dormLeaderId",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const dormLeaderId = pathParam(req.params.dormLeaderId);
    if (!dormLeaderId || !z.string().uuid().safeParse(dormLeaderId).success) {
      res.status(400).json({ error: "Invalid dorm leader id" });
      return;
    }

    const result = await prisma.dormLeader.updateMany({
      where: { id: dormLeaderId, campYearId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) {
      res.status(404).json({ error: "Dorm leader not found" });
      return;
    }

    writeOpsLog("dorm_leader_deleted", {
      adminUserId: req.adminUser?.id,
      campYearId,
      dormLeaderId,
    });
    res.status(204).send();
  },
);

export const adminCampYearDormLeadersRouter = router;
