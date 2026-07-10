import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams } from "../lib/campYearParams.js";
import { evaluateCamperCapacity } from "../lib/camperCapacity.js";
import {
  CAMPER_COLUMN_KEYS,
  DORM_LEADER_COLUMN_KEYS,
  runImportPreview,
  WORKER_COLUMN_KEYS,
  type CamperImportPayload,
  type CsvImportKind,
} from "../lib/csvImportCore.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole, CamperPaymentStatus, CheckInStatus, DormPurpose, Gender, ImportSource } =
  prismaClientPkg;

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin));

const csvImportBody = z.object({
  kind: z.enum(["camper", "worker", "dorm_leader"]),
  csvText: z.string(),
  columnMap: z.record(z.union([z.string(), z.null()])).optional(),
  confirmCapacityOverride: z.boolean().optional(),
  /** When true, rows with validation errors are omitted; only valid rows are imported. */
  skipInvalidRows: z.boolean().optional(),
});

function logicalFieldsForKind(kind: CsvImportKind): readonly string[] {
  if (kind === "camper") {
    return CAMPER_COLUMN_KEYS;
  }
  if (kind === "worker") {
    return WORKER_COLUMN_KEYS;
  }
  return DORM_LEADER_COLUMN_KEYS;
}

router.post("/preview", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = csvImportBody.omit({ confirmCapacityOverride: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYear = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true, camperCapacity: true },
  });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const preview = runImportPreview(
    parsed.data.kind,
    parsed.data.csvText,
    parsed.data.columnMap,
  );

  const currentCamperCount =
    parsed.data.kind === "camper"
      ? await prisma.camper.count({ where: { campYearId, archivedAt: null } })
      : 0;

  const capacity =
    parsed.data.kind === "camper" && campYear.camperCapacity !== null && campYear.camperCapacity !== undefined
      ? {
          configuredCapacity: campYear.camperCapacity,
          currentCamperCount,
          additionalValidCampers: preview.validRowCount,
          wouldExceed:
            preview.validRowCount > 0 &&
            currentCamperCount + preview.validRowCount > campYear.camperCapacity,
        }
      : null;

  res.json({
    headers: preview.headers,
    suggestedColumnMap: preview.suggestedColumnMap,
    columnMap: preview.columnMap,
    mapError: preview.mapError,
    previewRows: preview.previewRows,
    validRowCount: preview.validRowCount,
    invalidRowCount: preview.invalidRowCount,
    rowWarningsFlat: preview.rowWarningsFlat,
    globalWarnings: preview.globalWarnings,
    capacity,
    logicalFields: logicalFieldsForKind(parsed.data.kind),
  });
});

router.post("/commit", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = csvImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYear = await prisma.campYear.findUnique({ where: { id: campYearId } });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const preview = runImportPreview(
    parsed.data.kind,
    parsed.data.csvText,
    parsed.data.columnMap,
  );

  if (preview.mapError) {
    res.status(400).json({ error: "invalid_column_map", message: preview.mapError });
    return;
  }

  if (preview.previewRows.length === 0) {
    res.status(400).json({ error: "no_rows_to_import" });
    return;
  }

  const skipInvalidRows = parsed.data.skipInvalidRows === true;
  const rowsWithErrors = preview.previewRows.filter((row) => row.errors.length > 0);
  if (rowsWithErrors.length > 0 && !skipInvalidRows) {
    res.status(400).json({
      error: "commit_blocked_row_errors",
      rowErrors: rowsWithErrors.map((row) => ({
        rowNumber: row.rowNumber,
        errors: row.errors,
      })),
    });
    return;
  }

  if (preview.payloads.length === 0) {
    res.status(400).json({
      error: "no_valid_rows_to_commit",
      message:
        skipInvalidRows && rowsWithErrors.length > 0
          ? "Every data row has errors; nothing to import. Fix the file or column mapping and try again."
          : "No valid rows to import.",
    });
    return;
  }

  const skippedInvalidRows = skipInvalidRows ? rowsWithErrors.length : 0;

  if (parsed.data.kind === "camper") {
    const payloads = preview.payloads as CamperImportPayload[];

    const currentCount = await prisma.camper.count({
      where: { campYearId, archivedAt: null },
    });

    const capacityCheck = evaluateCamperCapacity({
      capacity: campYear.camperCapacity,
      currentCount,
      additionalCampers: payloads.length,
      confirmCapacityOverride: parsed.data.confirmCapacityOverride ?? false,
    });
    if (!capacityCheck.ok) {
      res.status(409).json(capacityCheck.body);
      return;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const camperDorms = await tx.dorm.findMany({
          where: { campYearId, purpose: DormPurpose.camper },
          select: { id: true, name: true },
        });
        const dormIdByName = new Map(
          camperDorms.map((dorm) => [dorm.name.trim().toLowerCase(), dorm.id]),
        );
        const out: { id: string; firstName: string; lastName: string }[] = [];
        for (const row of payloads) {
          const dob = new Date(`${row.dateOfBirth}T12:00:00.000Z`);
          const checkedInAt = row.checkedInAt
            ? new Date(`${row.checkedInAt}T12:00:00.000Z`)
            : null;
          const payment =
            row.paymentStatus === "paid_stripe"
              ? CamperPaymentStatus.paid_stripe
              : row.paymentStatus === "paid_cash"
                ? CamperPaymentStatus.paid_cash
                : CamperPaymentStatus.unpaid;
          const dormId = row.dormName
            ? dormIdByName.get(row.dormName.trim().toLowerCase()) ?? null
            : null;
          const camper = await tx.camper.create({
            data: {
              campYearId,
              firstName: row.firstName,
              lastName: row.lastName,
              middleName: row.middleName,
              dateOfBirth: dob,
              gender: row.gender === "male" ? Gender.male : Gender.female,
              streetAddress: row.streetAddress,
              city: row.city,
              stateOrProvince: row.stateOrProvince,
              postalCode: row.postalCode,
              country: row.country,
              camperCellPhone: row.camperCellPhone,
              guardianName: row.guardianName,
              guardianEmail: row.guardianEmail,
              guardianPhone: row.guardianPhone,
              emergencyContactName: row.emergencyContactName,
              emergencyContactPhone: row.emergencyContactPhone,
              medicalNotes: row.medicalNotes,
              dietaryRestrictions: row.dietaryRestrictions,
              feeDueCents: row.feeDueCents,
              feePaidCents: row.feePaidCents,
              paymentStatus: payment,
              dormId,
              checkInStatus: checkedInAt ? CheckInStatus.checked_in : CheckInStatus.not_checked_in,
              checkedInAt,
              medicalReleaseSigned: false,
              importSource: ImportSource.csv_import,
            },
            select: { id: true, firstName: true, lastName: true },
          });
          out.push(camper);
        }
        return out;
      });
      writeOpsLog("csv_import_committed", {
        actorAdminUserId: req.adminUser?.id,
        campYearId,
        kind: "camper",
        importedCount: created.length,
        skippedInvalidRows,
      });
      res.status(201).json({
        imported: created.length,
        kind: "camper",
        records: created,
        ...(skippedInvalidRows > 0 ? { skippedInvalidRows } : {}),
      });
    } catch {
      res.status(500).json({ error: "import_transaction_failed" });
    }
    return;
  }

  if (parsed.data.kind === "worker") {
    const payloads = preview.payloads as Array<{
      email: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string | null;
      gender: "male" | "female";
      cellPhone: string;
      altPhone: string | null;
      streetAddress: string;
      city: string;
      stateOrProvince: string;
      postalCode: string;
      country: string;
      taskPreferenceFirst: string | null;
      taskPreferenceSecond: string | null;
      taskPreferenceThird: string | null;
      tShirtSize: string | null;
    }>;

    try {
      const created = await prisma.$transaction(async (tx) => {
        const out: { id: string; email: string; firstName: string; lastName: string }[] = [];
        for (const row of payloads) {
          const dob = row.dateOfBirth
            ? new Date(`${row.dateOfBirth}T12:00:00.000Z`)
            : null;
          const worker = await tx.worker.create({
            data: {
              campYearId,
              email: row.email,
              firstName: row.firstName,
              lastName: row.lastName,
              dateOfBirth: dob,
              gender: row.gender === "male" ? Gender.male : Gender.female,
              cellPhone: row.cellPhone,
              altPhone: row.altPhone,
              streetAddress: row.streetAddress,
              city: row.city,
              stateOrProvince: row.stateOrProvince,
              postalCode: row.postalCode,
              country: row.country,
              taskPreferenceFirst: row.taskPreferenceFirst,
              taskPreferenceSecond: row.taskPreferenceSecond,
              taskPreferenceThird: row.taskPreferenceThird,
              tShirtSize: row.tShirtSize,
              dormId: null,
              importSource: ImportSource.csv_import,
            },
            select: { id: true, email: true, firstName: true, lastName: true },
          });
          out.push(worker);
        }
        return out;
      });
      writeOpsLog("csv_import_committed", {
        actorAdminUserId: req.adminUser?.id,
        campYearId,
        kind: "worker",
        importedCount: created.length,
        skippedInvalidRows,
      });
      res.status(201).json({
        imported: created.length,
        kind: "worker",
        records: created,
        ...(skippedInvalidRows > 0 ? { skippedInvalidRows } : {}),
      });
    } catch {
      res.status(500).json({ error: "import_transaction_failed" });
    }
    return;
  }

  const payloads = preview.payloads as Array<{
    firstName: string;
    lastName: string;
    gender: "male" | "female";
    email: string;
    phone: string;
    roleLabel: string | null;
  }>;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const out: { id: string; email: string; firstName: string; lastName: string }[] = [];
      for (const row of payloads) {
        const leader = await tx.dormLeader.create({
          data: {
            campYearId,
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender === "male" ? Gender.male : Gender.female,
            email: row.email,
            phone: row.phone,
            roleLabel: row.roleLabel,
            assignedCamperDormId: null,
            importSource: ImportSource.csv_import,
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });
        out.push(leader);
      }
      return out;
    });
    writeOpsLog("csv_import_committed", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      kind: "dorm_leader",
      importedCount: created.length,
      skippedInvalidRows,
    });
    res.status(201).json({
      imported: created.length,
      kind: "dorm_leader",
      records: created,
      ...(skippedInvalidRows > 0 ? { skippedInvalidRows } : {}),
    });
  } catch {
    res.status(500).json({ error: "import_transaction_failed" });
  }
});

export const adminCampYearCsvImportRouter = router;
