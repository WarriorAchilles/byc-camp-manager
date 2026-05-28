import prismaClientPkg from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { campYearIdFromParams } from "../lib/campYearParams.js";
import { CAMPER_FEE_COLUMN_KEYS, runCamperFeeImportPreview } from "../lib/camperFeeCsv.js";
import { writeOpsLog } from "../lib/opsLog.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const { AdminRole } = prismaClientPkg;

const router = Router({ mergeParams: true });

router.use(requireAuth);
router.use(requireRole(AdminRole.super_admin));

const feeImportBody = z.object({
  csvText: z.string(),
  columnMap: z.record(z.union([z.string(), z.null()])).optional(),
  skipInvalidRows: z.boolean().optional(),
});

router.post("/preview", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = feeImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYear = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true },
  });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const campers = await prisma.camper.findMany({
    where: { campYearId, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, paymentStatus: true },
  });

  const preview = runCamperFeeImportPreview(parsed.data.csvText, parsed.data.columnMap, campers);

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
    logicalFields: [...CAMPER_FEE_COLUMN_KEYS],
  });
});

router.post("/commit", async (req: AuthedRequest, res) => {
  const campYearId = campYearIdFromParams(req.params.campYearId, res);
  if (!campYearId) {
    return;
  }
  const parsed = feeImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYear = await prisma.campYear.findUnique({
    where: { id: campYearId },
    select: { id: true },
  });
  if (!campYear) {
    res.status(404).json({ error: "Camp year not found" });
    return;
  }

  const campers = await prisma.camper.findMany({
    where: { campYearId, archivedAt: null },
    select: { id: true, firstName: true, lastName: true, paymentStatus: true },
  });

  const preview = runCamperFeeImportPreview(parsed.data.csvText, parsed.data.columnMap, campers);

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

  try {
    await prisma.$transaction(
      preview.payloads.map((payload) =>
        prisma.camper.update({
          where: { id: payload.camperId, campYearId },
          data: {
            feeDueCents: payload.feeDueCents,
            feePaidCents: payload.feePaidCents,
            paymentStatus: payload.paymentStatus,
          },
        }),
      ),
    );
    writeOpsLog("camper_fee_csv_import_committed", {
      actorAdminUserId: req.adminUser?.id,
      campYearId,
      updatedCount: preview.payloads.length,
      skippedInvalidRows,
    });
    res.status(200).json({
      updated: preview.payloads.length,
      records: preview.payloads.map((payload) => ({
        camperId: payload.camperId,
        feeDueCents: payload.feeDueCents,
        feePaidCents: payload.feePaidCents,
        paymentStatus: payload.paymentStatus,
      })),
      ...(skippedInvalidRows > 0 ? { skippedInvalidRows } : {}),
    });
  } catch {
    res.status(500).json({ error: "import_transaction_failed" });
  }
});

export const adminCampYearCamperFeeImportRouter = router;
