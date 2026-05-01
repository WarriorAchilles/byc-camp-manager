import {
  AdminRole,
  DormGenderDesignation,
  DormPurpose,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminCampYearCampersRouter } from "./adminCampYearCampers.js";
import { adminCampYearCsvImportRouter } from "./adminCampYearCsvImport.js";
import { adminCampYearDormLeadersRouter } from "./adminCampYearDormLeaders.js";
import { adminCampYearWorkersRouter } from "./adminCampYearWorkers.js";

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const campYearCreateBody = z.object({
  name: z.string().min(1),
  yearLabel: z.string().min(1),
  startDate: isoDateString,
  endDate: isoDateString,
  camperCapacity: z.number().int().positive().nullable().optional(),
  familyRegistrationOpensAt: z.string().datetime().nullable().optional(),
  workerRegistrationOpensAt: z.string().datetime().nullable().optional(),
  feeCutoverAt: z.string().datetime().nullable().optional(),
  earlyCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  lateCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  thirdPlusCamperFeeCents: z.number().int().nonnegative().nullable().optional(),
  discountTierNotes: z.string().nullable().optional(),
  merchandisePlaceholderNotes: z.string().nullable().optional(),
});

const campYearPatchBody = campYearCreateBody.partial();

const ageBracketCreateBody = z.object({
  label: z.string().min(1),
  minAge: z.number().int().min(0).max(120),
  maxAge: z.number().int().min(0).max(120),
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

export const adminCampYearsRouter = Router();

adminCampYearsRouter.use(requireAuth);

adminCampYearsRouter.get("/", requireRole(AdminRole.super_admin, AdminRole.camp_admin), async (_req, res) => {
  const campYears = await prisma.campYear.findMany({
    orderBy: { startDate: "desc" },
  });
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
    const created = await prisma.campYear.create({
      data: {
        name: parsed.data.name.trim(),
        yearLabel: parsed.data.yearLabel.trim(),
        startDate: start,
        endDate: end,
        camperCapacity: parsed.data.camperCapacity ?? null,
        familyRegistrationOpensAt: parsed.data.familyRegistrationOpensAt
          ? new Date(parsed.data.familyRegistrationOpensAt)
          : null,
        workerRegistrationOpensAt: parsed.data.workerRegistrationOpensAt
          ? new Date(parsed.data.workerRegistrationOpensAt)
          : null,
        feeCutoverAt: parsed.data.feeCutoverAt ? new Date(parsed.data.feeCutoverAt) : null,
        earlyCamperFeeCents: parsed.data.earlyCamperFeeCents ?? null,
        lateCamperFeeCents: parsed.data.lateCamperFeeCents ?? null,
        thirdPlusCamperFeeCents: parsed.data.thirdPlusCamperFeeCents ?? null,
        discountTierNotes: parsed.data.discountTierNotes?.trim() ?? null,
        merchandisePlaceholderNotes: parsed.data.merchandisePlaceholderNotes?.trim() ?? null,
      },
    });
    res.status(201).json(created);
  },
);

adminCampYearsRouter.use("/:campYearId/campers", adminCampYearCampersRouter);
adminCampYearsRouter.use("/:campYearId/workers", adminCampYearWorkersRouter);
adminCampYearsRouter.use("/:campYearId/dorm-leaders", adminCampYearDormLeadersRouter);
adminCampYearsRouter.use("/:campYearId/csv-import", adminCampYearCsvImportRouter);

const ageBracketRouter = Router({ mergeParams: true });
ageBracketRouter.use(requireAuth);
ageBracketRouter.use(requireRole(AdminRole.super_admin));

ageBracketRouter.get("/", async (req: AuthedRequest, res) => {
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

ageBracketRouter.post("/", async (req: AuthedRequest, res) => {
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
  if (parsed.data.minAge > parsed.data.maxAge) {
    res.status(400).json({ error: "minAge cannot exceed maxAge" });
    return;
  }
  const created = await prisma.ageGroupBracket.create({
    data: {
      campYearId,
      label: parsed.data.label.trim(),
      minAge: parsed.data.minAge,
      maxAge: parsed.data.maxAge,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive ?? true,
    },
  });
  res.status(201).json(created);
});

ageBracketRouter.patch("/:bracketId", async (req: AuthedRequest, res) => {
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
  const maxAge = parsed.data.maxAge ?? existing.maxAge;
  if (minAge > maxAge) {
    res.status(400).json({ error: "minAge cannot exceed maxAge" });
    return;
  }

  const updated = await prisma.ageGroupBracket.update({
    where: { id: bracketId },
    data: {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label.trim() } : {}),
      ...(parsed.data.minAge !== undefined ? { minAge: parsed.data.minAge } : {}),
      ...(parsed.data.maxAge !== undefined ? { maxAge: parsed.data.maxAge } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });
  res.json(updated);
});

adminCampYearsRouter.use("/:campYearId/age-group-brackets", ageBracketRouter);

const dormRouter = Router({ mergeParams: true });
dormRouter.use(requireAuth);
dormRouter.use(requireRole(AdminRole.super_admin));

dormRouter.get("/", async (req: AuthedRequest, res) => {
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

dormRouter.post("/", async (req: AuthedRequest, res) => {
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

dormRouter.patch("/:dormId", async (req: AuthedRequest, res) => {
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

adminCampYearsRouter.use("/:campYearId/dorms", dormRouter);

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
        ...(parsed.data.workerRegistrationOpensAt !== undefined
          ? {
              workerRegistrationOpensAt: parsed.data.workerRegistrationOpensAt
                ? new Date(parsed.data.workerRegistrationOpensAt)
                : null,
            }
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
        ...(parsed.data.discountTierNotes !== undefined
          ? { discountTierNotes: parsed.data.discountTierNotes?.trim() ?? null }
          : {}),
        ...(parsed.data.merchandisePlaceholderNotes !== undefined
          ? {
              merchandisePlaceholderNotes: parsed.data.merchandisePlaceholderNotes?.trim() ?? null,
            }
          : {}),
      },
    });
    res.json(updated);
  },
);
