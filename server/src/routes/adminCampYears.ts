import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { getActiveCampYearId } from "../lib/activeCampYearSetting.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import { allocateUniqueCampYearSelfCheckInToken } from "../lib/qrToken.js";
import { ageOnCampStartUtc, isCamperDormCoEdDisallowed } from "../lib/dormAssignmentCore.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminCampYearCampersRouter } from "./adminCampYearCampers.js";
import { adminCampYearCheckInRouter } from "./adminCampYearCheckIn.js";
import { adminCampYearCamperFeeImportRouter } from "./adminCampYearCamperFeeImport.js";
import { adminCampYearCsvImportRouter } from "./adminCampYearCsvImport.js";
import { adminCampYearDormAssignmentsRouter } from "./adminCampYearDormAssignments.js";
import { adminCampYearDormLeadersRouter } from "./adminCampYearDormLeaders.js";
import { adminCampYearMerchandiseRouter } from "./adminCampYearMerchandise.js";
import { adminCampYearWorkersRouter } from "./adminCampYearWorkers.js";

const { AdminRole, CheckInStatus, DormGenderDesignation, DormPurpose, Gender } = prismaClientPkg;

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const campYearCreateBody = z.object({
  name: z.string().min(1),
  yearLabel: z.string().min(1),
  startDate: isoDateString,
  endDate: isoDateString,
  copyFromCampYearId: z.string().uuid().nullable().optional(),
  camperCapacity: z.number().int().positive().nullable().optional(),
  familyRegistrationOpensAt: z.string().datetime().nullable().optional(),
  familyRegistrationClosesAt: z.string().datetime().nullable().optional(),
  familyRegistrationEnabled: z.boolean().optional(),
  familyRegistrationHeaderContent: z.string().trim().min(1).max(10_000).optional(),
  familyRegistrationClosedMessage: z.string().trim().min(1).max(2_000).optional(),
  workerRegistrationOpensAt: z.string().datetime().nullable().optional(),
  workerRegistrationClosesAt: z.string().datetime().nullable().optional(),
  workerRegistrationEnabled: z.boolean().optional(),
  workerRegistrationHeaderContent: z.string().trim().min(1).max(10_000).optional(),
  workerRegistrationClosedMessage: z.string().trim().min(1).max(2_000).optional(),
  leaderRegistrationOpensAt: z.string().datetime().nullable().optional(),
  leaderRegistrationClosesAt: z.string().datetime().nullable().optional(),
  leaderRegistrationEnabled: z.boolean().optional(),
  leaderRegistrationHeaderContent: z.string().trim().min(1).max(10_000).optional(),
  leaderRegistrationClosedMessage: z.string().trim().min(1).max(2_000).optional(),
  feeCutoverAt: z.string().datetime().nullable().optional(),
  earlyCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  lateCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  thirdPlusCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  checkInFamilyPaymentOptionEnabled: z.boolean().optional(),
  checkInConfirmationEmailsEnabled: z.boolean().optional(),
});

const campYearPatchBody = campYearCreateBody.omit({ copyFromCampYearId: true }).partial();

const campYearDeleteBody = z.object({
  confirmationLabel: z.string(),
});

const ageBracketCreateBody = z.object({
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120).nullable().optional(),
  sortOrder: z.number().int(),
  isActive: z.boolean().optional(),
});

const ageBracketPatchBody = ageBracketCreateBody.partial();

const dormCreateBody = z.object({
  name: z.string().min(1),
  purpose: z.nativeEnum(DormPurpose),
  genderDesignation: z.nativeEnum(DormGenderDesignation),
  bedCapacity: z.number().int().positive(),
  ageGroupBracketId: z.string().uuid().nullable().optional(),
});

const dormPatchBody = dormCreateBody.partial();

/** Optional filters for GET …/dorms/:dormId/roster (query string). */
const dormRosterQuerySchema = z.object({
  checkInStatus: z.nativeEnum(CheckInStatus).optional(),
  gender: z.nativeEnum(Gender).optional(),
  ageGroupBracketId: z.string().uuid().optional(),
});

export const adminCampYearsRouter = Router();

adminCampYearsRouter.use(requireAuth);

adminCampYearsRouter.get("/", requireRole(AdminRole.super_admin, AdminRole.camp_admin), async (_req, res) => {
  const campYears = await prisma.campYear.findMany({
    orderBy: { startDate: "desc" },
  });
  const activeCampYearId = await getActiveCampYearId(prisma);
  const counts = await prisma.camper.groupBy({
    by: ["campYearId"],
    where: { archivedAt: null },
    _count: { _all: true },
  });
  const countByYear = new Map(counts.map((row) => [row.campYearId, row._count._all]));
  res.json({
    campYears: campYears.map((year) => ({
      ...year,
      activeCamperCount: countByYear.get(year.id) ?? 0,
    })),
    activeCampYearId,
  });
});

adminCampYearsRouter.post(
  "/",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const parsed = campYearCreateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const start = new Date(`${parsed.data.startDate}T12:00:00.000Z`);
    const end = new Date(`${parsed.data.endDate}T12:00:00.000Z`);
    if (end < start) {
      res.status(400).json({ error: "End date must be on or after start date" });
      return;
    }
    const familyOpensAt = parsed.data.familyRegistrationOpensAt ? new Date(parsed.data.familyRegistrationOpensAt) : null;
    const familyClosesAt = parsed.data.familyRegistrationClosesAt ? new Date(parsed.data.familyRegistrationClosesAt) : null;
    const workerOpensAt = parsed.data.workerRegistrationOpensAt ? new Date(parsed.data.workerRegistrationOpensAt) : null;
    const workerClosesAt = parsed.data.workerRegistrationClosesAt ? new Date(parsed.data.workerRegistrationClosesAt) : null;
    const leaderOpensAt = parsed.data.leaderRegistrationOpensAt ? new Date(parsed.data.leaderRegistrationOpensAt) : null;
    const leaderClosesAt = parsed.data.leaderRegistrationClosesAt ? new Date(parsed.data.leaderRegistrationClosesAt) : null;
    if ((familyOpensAt && familyClosesAt && familyClosesAt <= familyOpensAt) ||
        (workerOpensAt && workerClosesAt && workerClosesAt <= workerOpensAt) ||
        (leaderOpensAt && leaderClosesAt && leaderClosesAt <= leaderOpensAt)) {
      res.status(400).json({ error: "Registration close time must be after open time" });
      return;
    }
    const copySource = parsed.data.copyFromCampYearId
      ? await prisma.campYear.findUnique({
          where: { id: parsed.data.copyFromCampYearId },
          select: {
            ageGroupBrackets: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                minAge: true,
                maxAge: true,
                sortOrder: true,
                isActive: true,
              },
            },
            dorms: {
              select: {
                name: true,
                purpose: true,
                genderDesignation: true,
                bedCapacity: true,
                ageGroupBracketId: true,
              },
            },
          },
        })
      : null;
    if (parsed.data.copyFromCampYearId && !copySource) {
      res.status(400).json({ error: "Source camp year not found" });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const campYear = await tx.campYear.create({
        data: {
          name: parsed.data.name.trim(),
          yearLabel: parsed.data.yearLabel.trim(),
          startDate: start,
          endDate: end,
          camperCapacity: parsed.data.camperCapacity ?? null,
          familyRegistrationOpensAt: familyOpensAt,
          familyRegistrationClosesAt: familyClosesAt,
          familyRegistrationEnabled: parsed.data.familyRegistrationEnabled ?? false,
          ...(parsed.data.familyRegistrationHeaderContent ? { familyRegistrationHeaderContent: parsed.data.familyRegistrationHeaderContent } : {}),
          ...(parsed.data.familyRegistrationClosedMessage ? { familyRegistrationClosedMessage: parsed.data.familyRegistrationClosedMessage } : {}),
          workerRegistrationOpensAt: workerOpensAt,
          workerRegistrationClosesAt: workerClosesAt,
          workerRegistrationEnabled: parsed.data.workerRegistrationEnabled ?? false,
          ...(parsed.data.workerRegistrationHeaderContent ? { workerRegistrationHeaderContent: parsed.data.workerRegistrationHeaderContent } : {}),
          ...(parsed.data.workerRegistrationClosedMessage ? { workerRegistrationClosedMessage: parsed.data.workerRegistrationClosedMessage } : {}),
          leaderRegistrationOpensAt: leaderOpensAt,
          leaderRegistrationClosesAt: leaderClosesAt,
          leaderRegistrationEnabled: parsed.data.leaderRegistrationEnabled ?? false,
          ...(parsed.data.leaderRegistrationHeaderContent ? { leaderRegistrationHeaderContent: parsed.data.leaderRegistrationHeaderContent } : {}),
          ...(parsed.data.leaderRegistrationClosedMessage ? { leaderRegistrationClosedMessage: parsed.data.leaderRegistrationClosedMessage } : {}),
          feeCutoverAt: parsed.data.feeCutoverAt ? new Date(parsed.data.feeCutoverAt) : null,
          earlyCamperFeeCents: parsed.data.earlyCamperFeeCents ?? null,
          lateCamperFeeCents: parsed.data.lateCamperFeeCents ?? null,
          thirdPlusCamperFeeCents: parsed.data.thirdPlusCamperFeeCents ?? null,
          checkInFamilyPaymentOptionEnabled: parsed.data.checkInFamilyPaymentOptionEnabled ?? false,
          checkInConfirmationEmailsEnabled: parsed.data.checkInConfirmationEmailsEnabled ?? false,
        },
      });

      if (copySource) {
        const copiedBracketIds = new Map<string, string>();
        for (const sourceBracket of copySource.ageGroupBrackets) {
          const copiedBracket = await tx.ageGroupBracket.create({
            data: {
              campYearId: campYear.id,
              minAge: sourceBracket.minAge,
              maxAge: sourceBracket.maxAge,
              sortOrder: sourceBracket.sortOrder,
              isActive: sourceBracket.isActive,
            },
          });
          copiedBracketIds.set(sourceBracket.id, copiedBracket.id);
        }

        if (copySource.dorms.length > 0) {
          await tx.dorm.createMany({
            data: copySource.dorms.map((sourceDorm) => ({
              campYearId: campYear.id,
              name: sourceDorm.name,
              purpose: sourceDorm.purpose,
              genderDesignation: sourceDorm.genderDesignation,
              bedCapacity: sourceDorm.bedCapacity,
              ageGroupBracketId: sourceDorm.ageGroupBracketId
                ? copiedBracketIds.get(sourceDorm.ageGroupBracketId) ?? null
                : null,
            })),
          });
        }
      }

      return campYear;
    });
    res.status(201).json(created);
  },
);

adminCampYearsRouter.post(
  "/:campYearId/self-check-in/token",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const year = await prisma.campYear.findUnique({
      where: { id: campYearId },
      select: { id: true, selfCheckInToken: true },
    });
    if (!year) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    let token = year.selfCheckInToken;
    if (!token) {
      token = await allocateUniqueCampYearSelfCheckInToken(prisma);
      await prisma.campYear.update({
        where: { id: campYearId },
        data: { selfCheckInToken: token },
      });
    }
    res.json({ token });
  },
);

adminCampYearsRouter.post(
  "/:campYearId/self-check-in/token/regenerate",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const year = await prisma.campYear.findUnique({
      where: { id: campYearId },
      select: { id: true },
    });
    if (!year) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    const token = await allocateUniqueCampYearSelfCheckInToken(prisma);
    await prisma.campYear.update({
      where: { id: campYearId },
      data: { selfCheckInToken: token },
    });
    res.json({ token });
  },
);

adminCampYearsRouter.use("/:campYearId/campers", adminCampYearCampersRouter);
adminCampYearsRouter.use("/:campYearId/check-in", adminCampYearCheckInRouter);
adminCampYearsRouter.use("/:campYearId/workers", adminCampYearWorkersRouter);
adminCampYearsRouter.use("/:campYearId/dorm-leaders", adminCampYearDormLeadersRouter);
adminCampYearsRouter.use("/:campYearId/csv-import", adminCampYearCsvImportRouter);
adminCampYearsRouter.use("/:campYearId/camper-fee-csv", adminCampYearCamperFeeImportRouter);
adminCampYearsRouter.use("/:campYearId/merchandise", adminCampYearMerchandiseRouter);

const ageBracketRouter = Router({ mergeParams: true });
ageBracketRouter.use(requireAuth);

ageBracketRouter.get("/", requireRole(AdminRole.super_admin, AdminRole.camp_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }
  const brackets = await prisma.ageGroupBracket.findMany({
    where: { campYearId },
    orderBy: { sortOrder: "asc" },
  });
  res.json({ ageGroupBrackets: brackets });
});

ageBracketRouter.post("/", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = ageBracketCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }
  if (parsed.data.maxAge !== null && parsed.data.maxAge !== undefined &&
      parsed.data.minAge > parsed.data.maxAge) {
    res.status(400).json({ error: "minAge cannot exceed maxAge" });
    return;
  }
  const created = await prisma.ageGroupBracket.create({
    data: {
      campYearId,
      minAge: parsed.data.minAge,
      maxAge: parsed.data.maxAge ?? null,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive ?? true,
    },
  });
  res.status(201).json(created);
});

ageBracketRouter.patch("/:bracketId", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const bracketId = pathParam(req.params.bracketId);
  if (!bracketId || !z.string().uuid().safeParse(bracketId).success) {
    res.status(400).json({ error: "Invalid bracket id" });
    return;
  }
  const parsed = ageBracketPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const existing = await prisma.ageGroupBracket.findFirst({
    where: { id: bracketId, campYearId },
  });
  if (!existing) {
    res.status(404).json({ error: "Age group bracket not found" });
    return;
  }

  const minAge = parsed.data.minAge ?? existing.minAge;
  const maxAge = parsed.data.maxAge === undefined ? existing.maxAge : parsed.data.maxAge;
  if (maxAge !== null && minAge > maxAge) {
    res.status(400).json({ error: "minAge cannot exceed maxAge" });
    return;
  }

  const updated = await prisma.ageGroupBracket.update({
    where: { id: bracketId },
    data: {
      ...(parsed.data.minAge !== undefined ? { minAge: parsed.data.minAge } : {}),
      ...(parsed.data.maxAge !== undefined ? { maxAge: parsed.data.maxAge } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });
  res.json(updated);
});

ageBracketRouter.delete("/:bracketId", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const bracketId = pathParam(req.params.bracketId);
  if (!bracketId || !z.string().uuid().safeParse(bracketId).success) {
    res.status(400).json({ error: "Invalid bracket id" });
    return;
  }
  const existing = await prisma.ageGroupBracket.findFirst({
    where: { id: bracketId, campYearId },
    select: { id: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Age group bracket not found" });
    return;
  }
  await prisma.ageGroupBracket.delete({ where: { id: bracketId } });
  res.status(204).send();
});

adminCampYearsRouter.use("/:campYearId/age-group-brackets", ageBracketRouter);

adminCampYearsRouter.use("/:campYearId/dorm-assignments", adminCampYearDormAssignmentsRouter);

const dormReadRouter = Router({ mergeParams: true });
dormReadRouter.use(requireAuth);
dormReadRouter.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

dormReadRouter.get("/", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }
  const dorms = await prisma.dorm.findMany({
    where: { campYearId },
    orderBy: { name: "asc" },
  });
  res.json({ dorms });
});

dormReadRouter.get("/:dormId/roster", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormId = pathParam(req.params.dormId);
  if (!dormId || !z.string().uuid().safeParse(dormId).success) {
    res.status(400).json({ error: "Invalid dorm id" });
    return;
  }

  const rosterQueryParsed = dormRosterQuerySchema.safeParse({
    checkInStatus: typeof req.query.checkInStatus === "string" ? req.query.checkInStatus : undefined,
    gender: typeof req.query.gender === "string" ? req.query.gender : undefined,
    ageGroupBracketId: typeof req.query.ageGroupBracketId === "string" ? req.query.ageGroupBracketId : undefined,
  });
  if (!rosterQueryParsed.success) {
    res.status(400).json({ error: "Invalid roster query" });
    return;
  }
  const rosterFilters = rosterQueryParsed.data;

  const year = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true, name: true, yearLabel: true, startDate: true },
  });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const dorm = await prisma.dorm.findFirst({
    where: { id: dormId, campYearId },
    include: { ageGroupBracket: true },
  });
  if (!dorm) {
    res.status(404).json({ error: "Dorm not found" });
    return;
  }

  const dormLeaders = await prisma.dormLeader.findMany({
    where: { campYearId, assignedCamperDormId: dormId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      checkInStatus: true,
    },
  });

  if (dorm.purpose === DormPurpose.camper) {
    const [campers, workers] = await Promise.all([
      prisma.camper.findMany({
        where: { dormId, campYearId, archivedAt: null },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.worker.findMany({
        where: { dormId, campYearId, archivedAt: null },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
    ]);
    const camperRows = campers.map((camper) => {
      const age = ageOnCampStartUtc(camper.dateOfBirth, year.startDate);
      return {
        id: camper.id,
        firstName: camper.firstName,
        lastName: camper.lastName,
        gender: camper.gender,
        age,
        checkInStatus: camper.checkInStatus,
        medicalNotes: camper.medicalNotes,
        dietaryRestrictions: camper.dietaryRestrictions,
        guardianName: camper.guardianName,
        guardianPhone: camper.guardianPhone,
      };
    });

    let ageBracketFilter: { minAge: number; maxAge: number | null } | null = null;
    if (rosterFilters.ageGroupBracketId) {
      const bracket = await prisma.ageGroupBracket.findFirst({
        where: { id: rosterFilters.ageGroupBracketId, campYearId },
      });
      if (!bracket) {
        res.status(400).json({ error: "Age group bracket not found for this camp year" });
        return;
      }
      ageBracketFilter = { minAge: bracket.minAge, maxAge: bracket.maxAge };
    }

    const filteredCampers = camperRows.filter((row) => {
      if (rosterFilters.checkInStatus && row.checkInStatus !== rosterFilters.checkInStatus) {
        return false;
      }
      if (rosterFilters.gender && row.gender !== rosterFilters.gender) {
        return false;
      }
      if (ageBracketFilter &&
          (row.age < ageBracketFilter.minAge ||
           (ageBracketFilter.maxAge !== null && row.age > ageBracketFilter.maxAge))) {
        return false;
      }
      return true;
    });

    const medicalNotesSummaryLines: string[] = [];
    for (const row of filteredCampers) {
      const detailParts: string[] = [];
      if (row.medicalNotes) {
        detailParts.push(`Medical: ${row.medicalNotes}`);
      }
      if (row.dietaryRestrictions) {
        detailParts.push(`Dietary: ${row.dietaryRestrictions}`);
      }
      if (detailParts.length > 0) {
        medicalNotesSummaryLines.push(`${row.firstName} ${row.lastName}: ${detailParts.join("; ")}`);
      }
    }

    writeOpsLog("dorm_roster_viewed", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      dormId,
      dormPurpose: dorm.purpose,
      filterCheckInStatus: rosterFilters.checkInStatus ?? null,
      filterGender: rosterFilters.gender ?? null,
      filterAgeGroupBracketId: rosterFilters.ageGroupBracketId ?? null,
      occupantCount: filteredCampers.length + workers.length + dormLeaders.length,
    });

    res.json({
      campYear: {
        id: year.id,
        name: year.name,
        yearLabel: year.yearLabel,
        startDate: year.startDate.toISOString().slice(0, 10),
      },
      dorm: {
        id: dorm.id,
        name: dorm.name,
        purpose: dorm.purpose,
        genderDesignation: dorm.genderDesignation,
        bedCapacity: dorm.bedCapacity,
        ageGroupBracket: dorm.ageGroupBracket,
      },
      occupantCount: campers.length + workers.length + dormLeaders.length,
      dormLeaders,
      campers: filteredCampers,
      workers: workers.map((worker) => ({
        id: worker.id,
        firstName: worker.firstName,
        lastName: worker.lastName,
        age: worker.dateOfBirth ? ageOnCampStartUtc(worker.dateOfBirth, year.startDate) : null,
        checkInStatus: worker.checkInStatus,
      })),
      medicalNotesSummaryLines,
    });
    return;
  }

  const workers = await prisma.worker.findMany({
    where: { dormId, campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const workerRows = workers.map((worker) => ({
    id: worker.id,
    firstName: worker.firstName,
    lastName: worker.lastName,
    age: worker.dateOfBirth ? ageOnCampStartUtc(worker.dateOfBirth, year.startDate) : null,
    checkInStatus: worker.checkInStatus,
  }));

  writeOpsLog("dorm_roster_viewed", {
    actorAdminUserId: req.adminUser?.id,
    campYearId,
    dormId,
    dormPurpose: dorm.purpose,
    filterCheckInStatus: rosterFilters.checkInStatus ?? null,
    filterGender: rosterFilters.gender ?? null,
    filterAgeGroupBracketId: rosterFilters.ageGroupBracketId ?? null,
    occupantCount: workers.length,
  });

  res.json({
    campYear: {
      id: year.id,
      name: year.name,
      yearLabel: year.yearLabel,
      startDate: year.startDate.toISOString().slice(0, 10),
    },
    dorm: {
      id: dorm.id,
      name: dorm.name,
      purpose: dorm.purpose,
      genderDesignation: dorm.genderDesignation,
      bedCapacity: dorm.bedCapacity,
      ageGroupBracket: dorm.ageGroupBracket,
    },
    occupantCount: workers.length,
    dormLeaders,
    workers: workerRows,
    medicalNotesSummaryLines: [] as string[],
  });
});

const dormMutationRouter = Router({ mergeParams: true });
dormMutationRouter.use(requireAuth);
dormMutationRouter.use(requireRole(AdminRole.super_admin));

dormMutationRouter.post("/", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = dormCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const year = await prisma.campYear.findUnique({ where: { id: campYearId }, select: { id: true } });
  if (!year) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  if (parsed.data.ageGroupBracketId) {
    const bracket = await prisma.ageGroupBracket.findFirst({
      where: { id: parsed.data.ageGroupBracketId, campYearId },
    });
    if (!bracket) {
      res.status(400).json({ error: "Age group bracket not found for this camp year" });
      return;
    }
    if (parsed.data.purpose !== DormPurpose.camper) {
      res.status(400).json({ error: "Age group applies only to camper dorms" });
      return;
    }
  }

  if (isCamperDormCoEdDisallowed(parsed.data.purpose, parsed.data.genderDesignation)) {
    res.status(400).json({ error: "Camper dorms cannot be co-ed" });
    return;
  }

  const created = await prisma.dorm.create({
    data: {
      campYearId,
      name: parsed.data.name.trim(),
      purpose: parsed.data.purpose,
      genderDesignation: parsed.data.genderDesignation,
      bedCapacity: parsed.data.bedCapacity,
      ageGroupBracketId:
        parsed.data.purpose === DormPurpose.camper ? parsed.data.ageGroupBracketId ?? null : null,
    },
  });
  res.status(201).json(created);
});

dormMutationRouter.patch("/:dormId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormId = pathParam(req.params.dormId);
  if (!dormId || !z.string().uuid().safeParse(dormId).success) {
    res.status(400).json({ error: "Invalid dorm id" });
    return;
  }
  const parsed = dormPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const existing = await prisma.dorm.findFirst({
    where: { id: dormId, campYearId },
  });
  if (!existing) {
    res.status(404).json({ error: "Dorm not found" });
    return;
  }

  const nextPurpose = parsed.data.purpose ?? existing.purpose;
  let ageGroupBracketId = existing.ageGroupBracketId;
  if (parsed.data.ageGroupBracketId !== undefined) {
    ageGroupBracketId = parsed.data.ageGroupBracketId;
  }
  if (parsed.data.ageGroupBracketId !== undefined && ageGroupBracketId) {
    const bracket = await prisma.ageGroupBracket.findFirst({
      where: { id: ageGroupBracketId, campYearId },
    });
    if (!bracket) {
      res.status(400).json({ error: "Age group bracket not found for this camp year" });
      return;
    }
  }

  if (nextPurpose === DormPurpose.worker) {
    ageGroupBracketId = null;
  }

  const nextGender = parsed.data.genderDesignation ?? existing.genderDesignation;
  if (isCamperDormCoEdDisallowed(nextPurpose, nextGender)) {
    res.status(400).json({ error: "Camper dorms cannot be co-ed" });
    return;
  }

  const updated = await prisma.dorm.update({
    where: { id: dormId },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.purpose !== undefined ? { purpose: parsed.data.purpose } : {}),
      ...(parsed.data.genderDesignation !== undefined
        ? { genderDesignation: parsed.data.genderDesignation }
        : {}),
      ...(parsed.data.bedCapacity !== undefined ? { bedCapacity: parsed.data.bedCapacity } : {}),
      ageGroupBracketId,
    },
  });
  res.json(updated);
});

dormMutationRouter.delete("/:dormId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const dormId = pathParam(req.params.dormId);
  if (!dormId || !z.string().uuid().safeParse(dormId).success) {
    res.status(400).json({ error: "Invalid dorm id" });
    return;
  }
  const existing = await prisma.dorm.findFirst({
    where: { id: dormId, campYearId },
    select: { id: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Dorm not found" });
    return;
  }
  await prisma.dorm.delete({ where: { id: dormId } });
  res.status(204).send();
});

adminCampYearsRouter.use(
  "/:campYearId/dorms",
  dormReadRouter,
  dormMutationRouter,
);

adminCampYearsRouter.get(
  "/:campYearId",
  requireRole(AdminRole.super_admin, AdminRole.camp_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const campYear = await prisma.campYear.findUnique({
      where: { id: campYearId },
    });
    if (!campYear) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    const activeCamperCount = await prisma.camper.count({
      where: { campYearId, archivedAt: null },
    });
    res.json({
      ...campYear,
      activeCamperCount,
    });
  },
);

adminCampYearsRouter.patch(
  "/:campYearId",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const parsed = campYearPatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const existing = await prisma.campYear.findUnique({ where: { id: campYearId } });
    if (!existing) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }

    const start =
      parsed.data.startDate !== undefined
        ? new Date(`${parsed.data.startDate}T12:00:00.000Z`)
        : existing.startDate;
    const end =
      parsed.data.endDate !== undefined
        ? new Date(`${parsed.data.endDate}T12:00:00.000Z`)
        : existing.endDate;
    if (end < start) {
      res.status(400).json({ error: "End date must be on or after start date" });
      return;
    }
    const nextFamilyOpensAt = parsed.data.familyRegistrationOpensAt !== undefined
      ? (parsed.data.familyRegistrationOpensAt ? new Date(parsed.data.familyRegistrationOpensAt) : null)
      : existing.familyRegistrationOpensAt;
    const nextFamilyClosesAt = parsed.data.familyRegistrationClosesAt !== undefined
      ? (parsed.data.familyRegistrationClosesAt ? new Date(parsed.data.familyRegistrationClosesAt) : null)
      : existing.familyRegistrationClosesAt;
    const nextWorkerOpensAt = parsed.data.workerRegistrationOpensAt !== undefined
      ? (parsed.data.workerRegistrationOpensAt ? new Date(parsed.data.workerRegistrationOpensAt) : null)
      : existing.workerRegistrationOpensAt;
    const nextWorkerClosesAt = parsed.data.workerRegistrationClosesAt !== undefined
      ? (parsed.data.workerRegistrationClosesAt ? new Date(parsed.data.workerRegistrationClosesAt) : null)
      : existing.workerRegistrationClosesAt;
    const nextLeaderOpensAt = parsed.data.leaderRegistrationOpensAt !== undefined
      ? (parsed.data.leaderRegistrationOpensAt ? new Date(parsed.data.leaderRegistrationOpensAt) : null)
      : existing.leaderRegistrationOpensAt;
    const nextLeaderClosesAt = parsed.data.leaderRegistrationClosesAt !== undefined
      ? (parsed.data.leaderRegistrationClosesAt ? new Date(parsed.data.leaderRegistrationClosesAt) : null)
      : existing.leaderRegistrationClosesAt;
    if ((nextFamilyOpensAt && nextFamilyClosesAt && nextFamilyClosesAt <= nextFamilyOpensAt) ||
        (nextWorkerOpensAt && nextWorkerClosesAt && nextWorkerClosesAt <= nextWorkerOpensAt) ||
        (nextLeaderOpensAt && nextLeaderClosesAt && nextLeaderClosesAt <= nextLeaderOpensAt)) {
      res.status(400).json({ error: "Registration close time must be after open time" });
      return;
    }

    const updated = await prisma.campYear.update({
      where: { id: campYearId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.yearLabel !== undefined ? { yearLabel: parsed.data.yearLabel.trim() } : {}),
        ...(parsed.data.startDate !== undefined ? { startDate: start } : {}),
        ...(parsed.data.endDate !== undefined ? { endDate: end } : {}),
        ...(parsed.data.camperCapacity !== undefined ? { camperCapacity: parsed.data.camperCapacity } : {}),
        ...(parsed.data.familyRegistrationOpensAt !== undefined
          ? {
              familyRegistrationOpensAt: parsed.data.familyRegistrationOpensAt
                ? new Date(parsed.data.familyRegistrationOpensAt)
                : null,
            }
          : {}),
        ...(parsed.data.familyRegistrationClosesAt !== undefined
          ? { familyRegistrationClosesAt: nextFamilyClosesAt }
          : {}),
        ...(parsed.data.familyRegistrationEnabled !== undefined
          ? { familyRegistrationEnabled: parsed.data.familyRegistrationEnabled }
          : {}),
        ...(parsed.data.familyRegistrationHeaderContent !== undefined
          ? { familyRegistrationHeaderContent: parsed.data.familyRegistrationHeaderContent }
          : {}),
        ...(parsed.data.familyRegistrationClosedMessage !== undefined
          ? { familyRegistrationClosedMessage: parsed.data.familyRegistrationClosedMessage }
          : {}),
        ...(parsed.data.workerRegistrationOpensAt !== undefined
          ? {
              workerRegistrationOpensAt: parsed.data.workerRegistrationOpensAt
                ? new Date(parsed.data.workerRegistrationOpensAt)
                : null,
            }
          : {}),
        ...(parsed.data.workerRegistrationClosesAt !== undefined
          ? { workerRegistrationClosesAt: nextWorkerClosesAt }
          : {}),
        ...(parsed.data.workerRegistrationEnabled !== undefined
          ? { workerRegistrationEnabled: parsed.data.workerRegistrationEnabled }
          : {}),
        ...(parsed.data.workerRegistrationHeaderContent !== undefined
          ? { workerRegistrationHeaderContent: parsed.data.workerRegistrationHeaderContent }
          : {}),
        ...(parsed.data.workerRegistrationClosedMessage !== undefined
          ? { workerRegistrationClosedMessage: parsed.data.workerRegistrationClosedMessage }
          : {}),
        ...(parsed.data.leaderRegistrationOpensAt !== undefined
          ? { leaderRegistrationOpensAt: nextLeaderOpensAt }
          : {}),
        ...(parsed.data.leaderRegistrationClosesAt !== undefined
          ? { leaderRegistrationClosesAt: nextLeaderClosesAt }
          : {}),
        ...(parsed.data.leaderRegistrationEnabled !== undefined
          ? { leaderRegistrationEnabled: parsed.data.leaderRegistrationEnabled }
          : {}),
        ...(parsed.data.leaderRegistrationHeaderContent !== undefined
          ? { leaderRegistrationHeaderContent: parsed.data.leaderRegistrationHeaderContent }
          : {}),
        ...(parsed.data.leaderRegistrationClosedMessage !== undefined
          ? { leaderRegistrationClosedMessage: parsed.data.leaderRegistrationClosedMessage }
          : {}),
        ...(parsed.data.feeCutoverAt !== undefined
          ? { feeCutoverAt: parsed.data.feeCutoverAt ? new Date(parsed.data.feeCutoverAt) : null }
          : {}),
        ...(parsed.data.earlyCamperFeeCents !== undefined
          ? { earlyCamperFeeCents: parsed.data.earlyCamperFeeCents }
          : {}),
        ...(parsed.data.lateCamperFeeCents !== undefined
          ? { lateCamperFeeCents: parsed.data.lateCamperFeeCents }
          : {}),
        ...(parsed.data.thirdPlusCamperFeeCents !== undefined
          ? { thirdPlusCamperFeeCents: parsed.data.thirdPlusCamperFeeCents }
          : {}),
        ...(parsed.data.checkInFamilyPaymentOptionEnabled !== undefined
          ? { checkInFamilyPaymentOptionEnabled: parsed.data.checkInFamilyPaymentOptionEnabled }
          : {}),
        ...(parsed.data.checkInConfirmationEmailsEnabled !== undefined
          ? { checkInConfirmationEmailsEnabled: parsed.data.checkInConfirmationEmailsEnabled }
          : {}),
      },
    });
    res.json(updated);
  },
);

adminCampYearsRouter.delete(
  "/:campYearId",
  requireRole(AdminRole.super_admin),
  async (req: AuthedRequest, res) => {
    const campYearId = campYearIdFromParams(req.params.campYearId, res);
    if (!campYearId) {
      return;
    }
    const parsed = campYearDeleteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const existing = await prisma.campYear.findUnique({
      where: { id: campYearId },
      select: { id: true, name: true, yearLabel: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Camp year not found" });
      return;
    }
    const expectedConfirmationLabel = `${existing.name} (${existing.yearLabel})`;
    if (parsed.data.confirmationLabel !== expectedConfirmationLabel) {
      res.status(400).json({ error: "Camp year confirmation label did not match" });
      return;
    }
    await prisma.campYear.delete({ where: { id: campYearId } });
    res.status(204).send();
  },
);
