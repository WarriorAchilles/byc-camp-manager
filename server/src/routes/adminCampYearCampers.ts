import prismaClientPkg, { type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams, pathParam } from "../lib/campYearParams.js";
import { evaluateCamperCapacity } from "../lib/camperCapacity.js";
import { writeOpsLog } from "../lib/opsLog.js";
import { allocateUniqueCamperQrToken } from "../lib/qrToken.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, CamperPaymentStatus, CheckInStatus, DormPurpose, Gender, ImportSource } =
  prismaClientPkg;

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin, AdminRole.camp_admin));

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const camperFields = {
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().nullable().optional(),
  dateOfBirth: isoDateString,
  gender: z.nativeEnum(Gender),
  streetAddress: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  stateOrProvince: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  camperCellPhone: z.string().nullable().optional(),
  guardianName: z.string().min(1),
  guardianEmail: z.string().email(),
  guardianPhone: z.string().min(1),
  emergencyContactName: z.string().nullable().optional(),
  emergencyContactPhone: z.string().nullable().optional(),
  medicalNotes: z.string().nullable().optional(),
  dietaryRestrictions: z.string().nullable().optional(),
  paymentStatus: z.nativeEnum(CamperPaymentStatus),
  feeDueCents: z.number().int().nonnegative().optional(),
  feePaidCents: z.number().int().nonnegative().optional(),
  dormId: z.string().uuid().nullable().optional(),
  medicalReleaseSigned: z.boolean().optional(),
};

const camperRowSchema = z.object(camperFields);

const createBody = z.object({
  ...camperFields,
  confirmCapacityOverride: z.boolean().optional(),
});

const updateBody = z
  .object({
    ...camperFields,
    guardianName: z.string(),
    guardianEmail: z.union([z.literal(""), z.string().email()]),
    guardianPhone: z.string(),
    checkInStatus: z.nativeEnum(CheckInStatus).optional(),
  })
  .partial();

const importBody = z.object({
  campers: z.array(camperRowSchema).min(1),
  confirmCapacityOverride: z.boolean().optional(),
});

async function assertCamperDormForYear(
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
    return { ok: false, status: 400, message: "Camper dorm assignment must reference a camper dorm" };
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
  const campers = await prisma.camper.findMany({
    where: { campYearId, archivedAt: null },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  res.json({ campers });
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
  const campYear = await prisma.campYear.findUnique({ where: { id: campYearId } });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const dormCheck = await assertCamperDormForYear(campYearId, parsed.data.dormId ?? null);
  if (!dormCheck.ok) {
    res.status(dormCheck.status).json({ error: dormCheck.message });
    return;
  }

  const currentCount = await prisma.camper.count({
    where: { campYearId, archivedAt: null },
  });

  const capacityCheck = evaluateCamperCapacity({
    capacity: campYear.camperCapacity,
    currentCount,
    additionalCampers: 1,
    confirmCapacityOverride: parsed.data.confirmCapacityOverride ?? false,
  });
  if (!capacityCheck.ok) {
    res.status(409).json(capacityCheck.body);
    return;
  }

  const dob = new Date(`${parsed.data.dateOfBirth}T12:00:00.000Z`);
  const qrToken = await allocateUniqueCamperQrToken(prisma);

  const created = await prisma.camper.create({
    data: {
      campYearId,
      firstName: parsed.data.firstName.trim(),
      lastName: parsed.data.lastName.trim(),
      middleName: parsed.data.middleName?.trim() ?? null,
      dateOfBirth: dob,
      gender: parsed.data.gender,
      streetAddress: parsed.data.streetAddress?.trim() ?? null,
      city: parsed.data.city?.trim() ?? null,
      stateOrProvince: parsed.data.stateOrProvince?.trim() ?? null,
      postalCode: parsed.data.postalCode?.trim() ?? null,
      country: parsed.data.country?.trim() ?? null,
      camperCellPhone: parsed.data.camperCellPhone?.trim() ?? null,
      guardianName: parsed.data.guardianName.trim(),
      guardianEmail: parsed.data.guardianEmail.trim().toLowerCase(),
      guardianPhone: parsed.data.guardianPhone.trim(),
      emergencyContactName: parsed.data.emergencyContactName?.trim() ?? null,
      emergencyContactPhone: parsed.data.emergencyContactPhone?.trim() ?? null,
      medicalNotes: parsed.data.medicalNotes?.trim() ?? null,
      dietaryRestrictions: parsed.data.dietaryRestrictions?.trim() ?? null,
      paymentStatus: parsed.data.paymentStatus,
      feeDueCents: parsed.data.feeDueCents,
      feePaidCents: parsed.data.feePaidCents,
      qrToken,
      dormId: parsed.data.dormId ?? null,
      medicalReleaseSigned: parsed.data.medicalReleaseSigned ?? false,
      importSource: ImportSource.admin_entry,
    },
  });
  res.status(201).json(created);
});

/** Bulk JSON import (e.g. CSV pipeline). Same capacity semantics as single admin create. */
router.post("/import", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = importBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYear = await prisma.campYear.findUnique({ where: { id: campYearId } });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const rows = parsed.data.campers;
  for (const row of rows) {
    const dormCheck = await assertCamperDormForYear(campYearId, row.dormId ?? null);
    if (!dormCheck.ok) {
      res.status(400).json({ error: dormCheck.message });
      return;
    }
  }

  const currentCount = await prisma.camper.count({
    where: { campYearId, archivedAt: null },
  });

  const capacityCheck = evaluateCamperCapacity({
    capacity: campYear.camperCapacity,
    currentCount,
    additionalCampers: rows.length,
    confirmCapacityOverride: parsed.data.confirmCapacityOverride ?? false,
  });
  if (!capacityCheck.ok) {
    res.status(409).json(capacityCheck.body);
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const out: { id: string; qrToken: string; firstName: string; lastName: string }[] = [];
    for (const row of rows) {
      const qrToken = await allocateUniqueCamperQrToken(tx);
      const dob = new Date(`${row.dateOfBirth}T12:00:00.000Z`);
      const camper = await tx.camper.create({
        data: {
          campYearId,
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          middleName: row.middleName?.trim() ?? null,
          dateOfBirth: dob,
          gender: row.gender,
          streetAddress: row.streetAddress?.trim() ?? null,
          city: row.city?.trim() ?? null,
          stateOrProvince: row.stateOrProvince?.trim() ?? null,
          postalCode: row.postalCode?.trim() ?? null,
          country: row.country?.trim() ?? null,
          camperCellPhone: row.camperCellPhone?.trim() ?? null,
          guardianName: row.guardianName.trim(),
          guardianEmail: row.guardianEmail.trim().toLowerCase(),
          guardianPhone: row.guardianPhone.trim(),
          emergencyContactName: row.emergencyContactName?.trim() ?? null,
          emergencyContactPhone: row.emergencyContactPhone?.trim() ?? null,
          medicalNotes: row.medicalNotes?.trim() ?? null,
          dietaryRestrictions: row.dietaryRestrictions?.trim() ?? null,
          paymentStatus: row.paymentStatus,
          feeDueCents: row.feeDueCents,
          feePaidCents: row.feePaidCents,
          qrToken,
          dormId: row.dormId ?? null,
          medicalReleaseSigned: row.medicalReleaseSigned ?? false,
          importSource: ImportSource.csv_import,
        },
        select: { id: true, qrToken: true, firstName: true, lastName: true },
      });
      out.push(camper);
    }
    return out;
  });

  res.status(201).json({ imported: created.length, campers: created });
});

router.get("/:camperId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }
  const camper = await prisma.camper.findFirst({
    where: { id: camperId, campYearId },
  });
  if (!camper) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }
  res.json(camper);
});

router.patch("/:camperId", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const existing = await prisma.camper.findFirst({
    where: { id: camperId, campYearId },
  });
  if (!existing) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  if (parsed.data.dormId !== undefined) {
    const dormCheck = await assertCamperDormForYear(campYearId, parsed.data.dormId ?? null);
    if (!dormCheck.ok) {
      res.status(dormCheck.status).json({ error: dormCheck.message });
      return;
    }
  }

  const data: Prisma.CamperUpdateInput = {};
  const partial = parsed.data;
  const transitioningToPaid =
    partial.paymentStatus !== undefined &&
    partial.paymentStatus !== CamperPaymentStatus.unpaid &&
    existing.paymentStatus === CamperPaymentStatus.unpaid;
  if (partial.firstName !== undefined) {
    data.firstName = partial.firstName.trim();
  }
  if (partial.lastName !== undefined) {
    data.lastName = partial.lastName.trim();
  }
  if (partial.middleName !== undefined) {
    data.middleName = partial.middleName?.trim() ?? null;
  }
  if (partial.dateOfBirth !== undefined) {
    data.dateOfBirth = new Date(`${partial.dateOfBirth}T12:00:00.000Z`);
  }
  if (partial.gender !== undefined) {
    data.gender = partial.gender;
  }
  if (partial.streetAddress !== undefined) {
    data.streetAddress = partial.streetAddress?.trim() ?? null;
  }
  if (partial.city !== undefined) {
    data.city = partial.city?.trim() ?? null;
  }
  if (partial.stateOrProvince !== undefined) {
    data.stateOrProvince = partial.stateOrProvince?.trim() ?? null;
  }
  if (partial.postalCode !== undefined) {
    data.postalCode = partial.postalCode?.trim() ?? null;
  }
  if (partial.country !== undefined) {
    data.country = partial.country?.trim() ?? null;
  }
  if (partial.camperCellPhone !== undefined) {
    data.camperCellPhone = partial.camperCellPhone?.trim() ?? null;
  }
  if (partial.guardianName !== undefined) {
    data.guardianName = partial.guardianName.trim();
  }
  if (partial.guardianEmail !== undefined) {
    data.guardianEmail = partial.guardianEmail.trim().toLowerCase();
  }
  if (partial.guardianPhone !== undefined) {
    data.guardianPhone = partial.guardianPhone.trim();
  }
  if (partial.emergencyContactName !== undefined) {
    data.emergencyContactName = partial.emergencyContactName?.trim() ?? null;
  }
  if (partial.emergencyContactPhone !== undefined) {
    data.emergencyContactPhone = partial.emergencyContactPhone?.trim() ?? null;
  }
  if (partial.medicalNotes !== undefined) {
    data.medicalNotes = partial.medicalNotes?.trim() ?? null;
  }
  if (partial.dietaryRestrictions !== undefined) {
    data.dietaryRestrictions = partial.dietaryRestrictions?.trim() ?? null;
  }
  if (partial.paymentStatus !== undefined) {
    data.paymentStatus = partial.paymentStatus;
    if (transitioningToPaid) {
      data.feePaidCents = partial.feeDueCents ?? existing.feeDueCents ?? 0;
    }
  }
  if (partial.feeDueCents !== undefined) {
    data.feeDueCents = partial.feeDueCents;
  }
  if (partial.feePaidCents !== undefined && !transitioningToPaid) {
    data.feePaidCents = partial.feePaidCents;
  }
  if (partial.dormId !== undefined) {
    data.dorm = partial.dormId
      ? { connect: { id: partial.dormId } }
      : { disconnect: true };
  }
  if (partial.medicalReleaseSigned !== undefined) {
    data.medicalReleaseSigned = partial.medicalReleaseSigned;
  }
  if (partial.checkInStatus !== undefined) {
    data.checkInStatus = partial.checkInStatus;
    if (partial.checkInStatus === CheckInStatus.checked_in && existing.checkInStatus !== CheckInStatus.checked_in) {
      data.checkedInAt = new Date();
    }
    if (partial.checkInStatus === CheckInStatus.not_checked_in) {
      data.checkedInAt = null;
    }
  }
  const updated = await prisma.camper.update({
    where: { id: camperId as string },
    data,
  });
  res.json(updated);
});

router.delete("/:camperId", requireRole(AdminRole.super_admin), async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }

  const result = await prisma.camper.updateMany({
    where: { id: camperId, campYearId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  writeOpsLog("camper_deleted", {
    adminUserId: req.adminUser?.id,
    campYearId,
    camperId,
  });
  res.status(204).send();
});

export const adminCampYearCampersRouter = router;
