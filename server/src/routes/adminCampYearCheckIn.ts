import { AdminRole, CamperPaymentStatus, CheckInStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  camperCheckInSelect,
  runCamperCheckInInTransaction,
  serializeCamperCheckIn,
} from "../lib/camperCheckInTx.js";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import { camperWhereForNameTokens, nameSearchTokens } from "../lib/camperNameSearch.js";
import { sendCheckInConfirmationMail } from "../lib/checkInConfirmationMail.js";
import { writeOpsLog } from "../lib/opsLog.js";
import { parseCamperQrTokenFromScan } from "../lib/qrToken.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

/** Dashboard aggregates for arrival day. */
router.get("/summary", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const baseCampers: Prisma.CamperWhereInput = { campYearId, archivedAt: null };
  const baseWorkers: Prisma.WorkerWhereInput = { campYearId, archivedAt: null };
  const baseLeaders: Prisma.DormLeaderWhereInput = { campYearId, archivedAt: null };

  const [
    campersRegistered,
    campersCheckedIn,
    workersRegistered,
    workersCheckedIn,
    dormLeadersRegistered,
    dormLeadersCheckedIn,
    unpaidCampers,
  ] = await Promise.all([
    prisma.camper.count({ where: baseCampers }),
    prisma.camper.count({ where: { ...baseCampers, checkInStatus: CheckInStatus.checked_in } }),
    prisma.worker.count({ where: baseWorkers }),
    prisma.worker.count({ where: { ...baseWorkers, checkInStatus: CheckInStatus.checked_in } }),
    prisma.dormLeader.count({ where: baseLeaders }),
    prisma.dormLeader.count({ where: { ...baseLeaders, checkInStatus: CheckInStatus.checked_in } }),
    prisma.camper.count({
      where: { ...baseCampers, paymentStatus: CamperPaymentStatus.unpaid },
    }),
  ]);

  res.json({
    campersRegistered,
    campersCheckedIn,
    workersRegistered,
    workersCheckedIn,
    dormLeadersRegistered,
    dormLeadersCheckedIn,
    unpaidCampersRemaining: unpaidCampers,
  });
});

/** Resolve a camper by QR token (hex) for this camp year. */
router.get("/lookup/qr", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const raw = typeof req.query.token === "string" ? req.query.token : "";
  const token = parseCamperQrTokenFromScan(raw);
  if (!token) {
    res.status(400).json({ error: "invalid_qr_token" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }
  const camper = await prisma.camper.findFirst({
    where: { campYearId, archivedAt: null, qrToken: token },
    select: camperCheckInSelect,
  });
  if (!camper) {
    res.status(404).json({ error: "camper_not_found_for_token" });
    return;
  }
  res.json({ camper: serializeCamperCheckIn(camper) });
});

router.get("/search/campers", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const tokens = nameSearchTokens(query);
  if (tokens.length === 0) {
    res.status(400).json({ error: "query_required" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const where = camperWhereForNameTokens(campYearId, tokens);

  const campers = await prisma.camper.findMany({
    where,
    select: camperCheckInSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });
  res.json({ campers: campers.map(serializeCamperCheckIn) });
});

router.get("/search/workers", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const tokens = nameSearchTokens(query);
  if (tokens.length === 0) {
    res.status(400).json({ error: "query_required" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  let where: Prisma.WorkerWhereInput = { campYearId, archivedAt: null };
  if (tokens.length >= 2) {
    const [a, b] = [tokens[0], tokens[1]];
    where = {
      ...where,
      AND: [
        {
          OR: [
            { firstName: { contains: a, mode: "insensitive" } },
            { lastName: { contains: a, mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { firstName: { contains: b, mode: "insensitive" } },
            { lastName: { contains: b, mode: "insensitive" } },
          ],
        },
      ],
    };
  } else {
    const t = tokens[0];
    where = {
      ...where,
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
      ],
    };
  }

  const workers = await prisma.worker.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      checkInStatus: true,
      checkedInAt: true,
      dorm: { select: { id: true, name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });
  res.json({
    workers: workers.map((worker) => ({
      id: worker.id,
      firstName: worker.firstName,
      lastName: worker.lastName,
      checkInStatus: worker.checkInStatus,
      checkedInAt: worker.checkedInAt?.toISOString() ?? null,
      dormAssignment: worker.dorm?.name ?? null,
    })),
  });
});

router.get("/search/dorm-leaders", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const tokens = nameSearchTokens(query);
  if (tokens.length === 0) {
    res.status(400).json({ error: "query_required" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  let where: Prisma.DormLeaderWhereInput = { campYearId, archivedAt: null };
  if (tokens.length >= 2) {
    const [a, b] = [tokens[0], tokens[1]];
    where = {
      ...where,
      AND: [
        {
          OR: [
            { firstName: { contains: a, mode: "insensitive" } },
            { lastName: { contains: a, mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { firstName: { contains: b, mode: "insensitive" } },
            { lastName: { contains: b, mode: "insensitive" } },
          ],
        },
      ],
    };
  } else {
    const t = tokens[0];
    where = {
      ...where,
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
      ],
    };
  }

  const dormLeaders = await prisma.dormLeader.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      checkInStatus: true,
      checkedInAt: true,
      assignedCamperDorm: { select: { id: true, name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });
  res.json({
    dormLeaders: dormLeaders.map((leader) => ({
      id: leader.id,
      firstName: leader.firstName,
      lastName: leader.lastName,
      checkInStatus: leader.checkInStatus,
      checkedInAt: leader.checkedInAt?.toISOString() ?? null,
      dormAssignment: leader.assignedCamperDorm?.name ?? null,
    })),
  });
});

const checkInPostBody = z.object({
  markPaidCashForCamper: z.boolean().optional(),
  markPaidCashForGuardianFamily: z.boolean().optional(),
});

router.post("/campers/:camperId/check-in", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }
  const parsed = checkInPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
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

  const now = new Date();
  let emailResult: Awaited<ReturnType<typeof sendCheckInConfirmationMail>> | null = null;

  const txResult = await prisma.$transaction(async (tx) =>
    runCamperCheckInInTransaction(tx, {
      campYearId,
      camperId,
      campStart: year.startDate,
      now,
      payments: {
        markPaidCashForCamper: parsed.data.markPaidCashForCamper,
        markPaidCashForGuardianFamily: parsed.data.markPaidCashForGuardianFamily,
      },
    }),
  );

  if (!txResult) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  const { camper: finalCamper, dormAutoAssigned, transitionedToCheckedIn } = txResult;

  if (transitionedToCheckedIn) {
    writeOpsLog("camper_check_in_admin", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      camperId,
      dormAutoAssigned,
    });
    const dormLabel = finalCamper.dorm?.name ?? "unassigned";
    const fullName = [finalCamper.firstName, finalCamper.middleName, finalCamper.lastName]
      .filter(Boolean)
      .join(" ");
    emailResult = await sendCheckInConfirmationMail({
      to: finalCamper.guardianEmail,
      camperFullName: fullName,
      dormLabel,
      checkedInAt: now,
    });
    writeOpsLog("check_in_confirmation_email", {
      campYearId,
      camperId,
      channel: "admin",
      result: emailResult.status,
    });
  }

  res.json({
    camper: serializeCamperCheckIn(finalCamper),
    alreadyCheckedIn: !transitionedToCheckedIn,
    checkInCompletedThisRequest: transitionedToCheckedIn,
    dormAutoAssigned,
    checkInConfirmationEmail: emailResult,
  });
});

router.post("/workers/:workerId/check-in", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const workerId = pathParam(req.params.workerId);
  if (!workerId || !z.string().uuid().safeParse(workerId).success) {
    res.status(400).json({ error: "Invalid worker id" });
    return;
  }

  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const now = new Date();
  let transitioned = false;

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.worker.findFirst({
      where: { id: workerId, campYearId, archivedAt: null },
    });
    if (!existing) {
      return null;
    }
    const wasCheckedIn = existing.checkInStatus === CheckInStatus.checked_in;
    if (!wasCheckedIn) {
      await tx.worker.update({
        where: { id: workerId },
        data: { checkInStatus: CheckInStatus.checked_in, checkedInAt: now },
      });
      transitioned = true;
    }
    return tx.worker.findFirstOrThrow({
      where: { id: workerId, campYearId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        checkInStatus: true,
        checkedInAt: true,
        dorm: { select: { id: true, name: true } },
      },
    });
  });

  if (!row) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  if (transitioned) {
    writeOpsLog("worker_check_in_admin", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      workerId,
    });
  }

  res.json({
    worker: {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      checkInStatus: row.checkInStatus,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      dormAssignment: row.dorm?.name ?? null,
    },
    alreadyCheckedIn: !transitioned,
  });
});

router.post("/dorm-leaders/:dormLeaderId/check-in", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormLeaderId = pathParam(req.params.dormLeaderId);
  if (!dormLeaderId || !z.string().uuid().safeParse(dormLeaderId).success) {
    res.status(400).json({ error: "Invalid dorm leader id" });
    return;
  }

  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const now = new Date();
  let transitioned = false;

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.dormLeader.findFirst({
      where: { id: dormLeaderId, campYearId, archivedAt: null },
    });
    if (!existing) {
      return null;
    }
    const wasCheckedIn = existing.checkInStatus === CheckInStatus.checked_in;
    if (!wasCheckedIn) {
      await tx.dormLeader.update({
        where: { id: dormLeaderId },
        data: { checkInStatus: CheckInStatus.checked_in, checkedInAt: now },
      });
      transitioned = true;
    }
    return tx.dormLeader.findFirstOrThrow({
      where: { id: dormLeaderId, campYearId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        checkInStatus: true,
        checkedInAt: true,
        assignedCamperDorm: { select: { id: true, name: true } },
      },
    });
  });

  if (!row) {
    res.status(404).json({ error: "Dorm leader not found" });
    return;
  }

  if (transitioned) {
    writeOpsLog("dorm_leader_check_in_admin", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      dormLeaderId,
    });
  }

  res.json({
    dormLeader: {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      checkInStatus: row.checkInStatus,
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      dormAssignment: row.assignedCamperDorm?.name ?? null,
    },
    alreadyCheckedIn: !transitioned,
  });
});

export const adminCampYearCheckInRouter = router;
