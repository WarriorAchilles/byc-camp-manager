import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  ageOnCampStartUtc,
  assertCamperDormPurpose,
  assertWorkerDormPurpose,
  autoAssignCampersGreedy,
  autoAssignWorkersGreedy,
  warningsAfterCamperAssignedToCamperDorm,
  warningsAfterWorkerAssignedToWorkerDorm,
} from "../lib/dormAssignmentCore.js";
import { campYearIdFromParams } from "../lib/campYearParams.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, DormPurpose } = prismaClientPkg;

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

const assignBody = z.object({
  personKind: z.enum(["camper", "worker", "dorm_leader"]),
  personId: z.string().uuid(),
  dormId: z.string().uuid().nullable(),
});

router.get("/board", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true, startDate: true },
  });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const dorms = await prisma.dorm.findMany({
    where: { campYearId },
    include: { ageGroupBracket: true },
    orderBy: { name: "asc" },
  });

  const campers = await prisma.camper.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const workers = await prisma.worker.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const dormLeaders = await prisma.dormLeader.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const camperDorms = dorms.filter((d) => d.purpose === DormPurpose.camper);
  const workerDorms = dorms.filter((d) => d.purpose === DormPurpose.worker);

  const camperDormIds = new Set(camperDorms.map((d) => d.id));
  const workerDormIds = new Set(workerDorms.map((d) => d.id));

  const boardCamperDorms = camperDorms.map((dorm) => ({
    ...dorm,
    campers: campers.filter((camper) => camper.dormId === dorm.id),
    occupantCount: campers.filter((camper) => camper.dormId === dorm.id).length,
    dormLeaders: dormLeaders.filter((leader) => leader.assignedCamperDormId === dorm.id),
  }));

  const boardWorkerDorms = workerDorms.map((dorm) => ({
    ...dorm,
    workers: workers.filter((worker) => worker.dormId === dorm.id),
    occupantCount: workers.filter((worker) => worker.dormId === dorm.id).length,
  }));

  const unassignedCampers = campers.filter(
    (camper) => !camper.dormId || !camperDormIds.has(camper.dormId),
  );
  const unassignedWorkers = workers.filter(
    (worker) => !worker.dormId || !workerDormIds.has(worker.dormId),
  );

  const unassignedDormLeaders = dormLeaders.filter(
    (leader) =>
      !leader.assignedCamperDormId || !camperDormIds.has(leader.assignedCamperDormId),
  );

  res.json({
    campYearStartDate: year.startDate.toISOString(),
    camperDorms: boardCamperDorms,
    workerDorms: boardWorkerDorms,
    unassignedCampers,
    unassignedWorkers,
    unassignedDormLeaders,
  });
});

router.post("/auto-assign", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true, startDate: true },
  });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const dorms = await prisma.dorm.findMany({
    where: { campYearId },
    include: { ageGroupBracket: true },
  });

  const campers = await prisma.camper.findMany({
    where: { campYearId, archivedAt: null },
  });
  const workers = await prisma.worker.findMany({
    where: { campYearId, archivedAt: null },
  });

  const camperDormRows = dorms.filter((d) => d.purpose === DormPurpose.camper);
  const workerDormRows = dorms.filter((d) => d.purpose === DormPurpose.worker);

  const camperCounts = new Map<string, number>();
  for (const dorm of camperDormRows) {
    const count = campers.filter((c) => c.dormId === dorm.id).length;
    camperCounts.set(dorm.id, count);
  }
  const workerCounts = new Map<string, number>();
  for (const dorm of workerDormRows) {
    const count = workers.filter((w) => w.dormId === dorm.id).length;
    workerCounts.set(dorm.id, count);
  }

  const campersNeedingDorm = campers.filter((c) => c.dormId === null);
  const workersNeedingDorm = workers.filter((w) => w.dormId === null);

  const camperSlots = camperDormRows.map((dorm) => ({
    id: dorm.id,
    name: dorm.name,
    purpose: dorm.purpose,
    genderDesignation: dorm.genderDesignation,
    bedCapacity: dorm.bedCapacity,
    ageGroupBracket: dorm.ageGroupBracket
      ? {
          minAge: dorm.ageGroupBracket.minAge,
          maxAge: dorm.ageGroupBracket.maxAge,
          sortOrder: dorm.ageGroupBracket.sortOrder,
        }
      : null,
  }));

  const workerSlots = workerDormRows.map((dorm) => ({
    id: dorm.id,
    name: dorm.name,
    purpose: dorm.purpose,
    genderDesignation: dorm.genderDesignation,
    bedCapacity: dorm.bedCapacity,
  }));

  const camperAssignments = autoAssignCampersGreedy(
    campersNeedingDorm.map((c) => ({
      id: c.id,
      gender: c.gender,
      dateOfBirth: c.dateOfBirth,
      lastName: c.lastName,
      firstName: c.firstName,
    })),
    camperCounts,
    camperSlots,
    year.startDate,
  );

  const workerAssignments = autoAssignWorkersGreedy(
    workersNeedingDorm.map((w) => ({
      id: w.id,
      gender: w.gender,
      lastName: w.lastName,
      firstName: w.firstName,
    })),
    workerCounts,
    workerSlots,
  );

  await prisma.$transaction(async (tx) => {
    for (const row of camperAssignments) {
      await tx.camper.update({
        where: { id: row.camperId },
        data: { dormId: row.dormId },
      });
    }
    for (const row of workerAssignments) {
      await tx.worker.update({
        where: { id: row.workerId },
        data: { dormId: row.dormId },
      });
    }
  });

  writeOpsLog("dorm_auto_assign_completed", {
    actorAdminUserId: req.adminUser?.id,
    campYearId,
    assignedCampers: camperAssignments.length,
    assignedWorkers: workerAssignments.length,
  });

  res.json({
    assignedCampers: camperAssignments.length,
    assignedWorkers: workerAssignments.length,
  });
});

router.post("/assign", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = assignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const year = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { startDate: true },
  });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const { personKind, personId, dormId } = parsed.data;

  if (personKind === "dorm_leader") {
    const leader = await prisma.dormLeader.findFirst({
      where: { id: personId, campYearId, archivedAt: null },
    });
    if (!leader) {
      res.status(404).json({ error: "Dorm leader not found" });
      return;
    }

    if (dormId === null) {
      await prisma.dormLeader.update({
        where: { id: personId },
        data: { assignedCamperDormId: null },
      });
      writeOpsLog("dorm_manual_assign", {
        actorAdminUserId: req.adminUser?.id,
        campYearId,
        personKind: "dorm_leader",
        personId,
        dormId: null,
      });
      res.json({ warnings: [] as string[] });
      return;
    }

    const dorm = await prisma.dorm.findFirst({
      where: { id: dormId, campYearId },
    });
    if (!dorm) {
      res.status(400).json({ error: "Dorm not found for this camp year" });
      return;
    }
    if (assertCamperDormPurpose(dorm.purpose) === "invalid") {
      res.status(400).json({ error: "Dorm leaders can only be assigned to camper dorms" });
      return;
    }

    await prisma.dormLeader.update({
      where: { id: personId },
      data: { assignedCamperDormId: dormId },
    });
    writeOpsLog("dorm_manual_assign", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      personKind: "dorm_leader",
      personId,
      dormId,
    });
    res.json({ warnings: [] as string[] });
    return;
  }

  if (personKind === "camper") {
    const camper = await prisma.camper.findFirst({
      where: { id: personId, campYearId, archivedAt: null },
    });
    if (!camper) {
      res.status(404).json({ error: "Camper not found" });
      return;
    }

    if (dormId === null) {
      await prisma.camper.update({
        where: { id: personId },
        data: { dormId: null },
      });
      writeOpsLog("dorm_manual_assign", {
        actorAdminUserId: req.adminUser?.id,
        campYearId,
        personKind: "camper",
        personId,
        dormId: null,
      });
      res.json({ warnings: [] as string[] });
      return;
    }

    const dorm = await prisma.dorm.findFirst({
      where: { id: dormId, campYearId },
      include: { ageGroupBracket: true },
    });
    if (!dorm) {
      res.status(400).json({ error: "Dorm not found for this camp year" });
      return;
    }
    if (assertCamperDormPurpose(dorm.purpose) === "invalid") {
      res.status(400).json({ error: "Campers can only be assigned to camper dorms" });
      return;
    }

    const countOthers = await prisma.camper.count({
      where: {
        dormId,
        campYearId,
        archivedAt: null,
        id: { not: personId },
      },
    });
    if (countOthers >= dorm.bedCapacity) {
      res.status(400).json({ error: "Dorm is at bed capacity" });
      return;
    }

    const camperAge = ageOnCampStartUtc(camper.dateOfBirth, year.startDate);
    const warnings = warningsAfterCamperAssignedToCamperDorm({
      camperGender: camper.gender,
      camperAge,
      dormGender: dorm.genderDesignation,
      dormBracket: dorm.ageGroupBracket
        ? {
            minAge: dorm.ageGroupBracket.minAge,
            maxAge: dorm.ageGroupBracket.maxAge,
            sortOrder: dorm.ageGroupBracket.sortOrder,
          }
        : null,
    });

    await prisma.camper.update({
      where: { id: personId },
      data: { dormId },
    });
    writeOpsLog("dorm_manual_assign", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      personKind: "camper",
      personId,
      dormId,
      warningCount: warnings.length,
    });
    res.json({ warnings });
    return;
  }

  const worker = await prisma.worker.findFirst({
    where: { id: personId, campYearId, archivedAt: null },
  });
  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  if (dormId === null) {
    await prisma.worker.update({
      where: { id: personId },
      data: { dormId: null },
    });
    writeOpsLog("dorm_manual_assign", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      personKind: "worker",
      personId,
      dormId: null,
    });
    res.json({ warnings: [] as string[] });
    return;
  }

  const dorm = await prisma.dorm.findFirst({
    where: { id: dormId, campYearId },
  });
  if (!dorm) {
    res.status(400).json({ error: "Dorm not found for this camp year" });
    return;
  }
  if (assertWorkerDormPurpose(dorm.purpose) === "invalid") {
    res.status(400).json({ error: "Workers can only be assigned to worker dorms" });
    return;
  }

  const countOthers = await prisma.worker.count({
    where: {
      dormId,
      campYearId,
      archivedAt: null,
      id: { not: personId },
    },
  });
  if (countOthers >= dorm.bedCapacity) {
    res.status(400).json({ error: "Dorm is at bed capacity" });
    return;
  }

  const warnings = warningsAfterWorkerAssignedToWorkerDorm({
    workerGender: worker.gender,
    dormGender: dorm.genderDesignation,
  });

  await prisma.worker.update({
    where: { id: personId },
    data: { dormId },
  });
  writeOpsLog("dorm_manual_assign", {
    actorAdminUserId: req.adminUser?.id,
    campYearId,
    personKind: "worker",
    personId,
    dormId,
    warningCount: warnings.length,
  });
  res.json({ warnings });
});

export const adminCampYearDormAssignmentsRouter = router;
