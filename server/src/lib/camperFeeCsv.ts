import { CamperPaymentStatus } from "@prisma/client";
import { parseCsvRows } from "./csvImportCore.js";

/** Logical column ids for camper fee CSV (API + UI). */
export const CAMPER_FEE_COLUMN_KEYS = ["firstName", "lastName", "feeDue", "feePaid"] as const;
export type CamperFeeColumnKey = (typeof CAMPER_FEE_COLUMN_KEYS)[number];

export type CamperFeeColumnMap = Record<CamperFeeColumnKey, string | null>;

function cell(raw: Record<string, string>, header: string | null | undefined): string {
  if (!header) {
    return "";
  }
  const value = raw[header];
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeHeaderLabel(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function findUnusedHeader(
  headers: string[],
  patterns: string[],
  used: Set<string>,
): string | null {
  for (const pattern of patterns) {
    const normalizedPattern = normalizeHeaderLabel(pattern);
    if (!normalizedPattern) {
      continue;
    }
    for (const header of headers) {
      if (used.has(header)) {
        continue;
      }
      const normalizedHeader = normalizeHeaderLabel(header);
      if (
        normalizedHeader === normalizedPattern ||
        normalizedHeader.includes(normalizedPattern)
      ) {
        return header;
      }
    }
  }
  return null;
}

export function suggestCamperFeeColumnMap(headers: string[]): CamperFeeColumnMap {
  const used = new Set<string>();
  const pick = (patterns: string[]) => {
    const header = findUnusedHeader(headers, patterns, used);
    if (header) {
      used.add(header);
    }
    return header;
  };
  return {
    firstName: pick(["first name", "camper first", "given name"]),
    lastName: pick(["last name", "surname", "family name"]),
    feeDue: pick(["fees due", "fee due", "amount due", "balance due", "total due"]),
    feePaid: pick(["fees paid", "fee paid", "amount paid", "paid", "payment"]),
  };
}

export function mergeCamperFeeColumnMap(
  suggested: CamperFeeColumnMap,
  overrides: Record<string, string | null | undefined> | undefined,
): CamperFeeColumnMap {
  const out: CamperFeeColumnMap = { ...suggested };
  if (!overrides) {
    return out;
  }
  for (const key of CAMPER_FEE_COLUMN_KEYS) {
    if (key in overrides) {
      const value = overrides[key];
      out[key] = value === undefined ? null : value;
    }
  }
  return out;
}

export function validateCamperFeeColumnMap(
  headers: string[],
  columnMap: CamperFeeColumnMap,
): string | null {
  const headerSet = new Set(headers);
  for (const key of CAMPER_FEE_COLUMN_KEYS) {
    const fileHeader = columnMap[key];
    if (fileHeader === null || fileHeader === "") {
      return `Column map is missing required field "${key}".`;
    }
    if (!headerSet.has(fileHeader)) {
      return `Column map for "${key}" references unknown header "${fileHeader}".`;
    }
  }
  const seen = new Set<string>();
  for (const key of CAMPER_FEE_COLUMN_KEYS) {
    const fileHeader = columnMap[key] as string;
    if (seen.has(fileHeader)) {
      return `CSV column "${fileHeader}" is mapped more than once.`;
    }
    seen.add(fileHeader);
  }
  return null;
}

/**
 * Parse a spreadsheet-style money cell into integer cents (non-negative).
 * Accepts optional $, thousands separators, and up to two decimal places.
 */
export function parseMoneyAmountToCents(
  raw: string,
): { ok: true; cents: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Amount is empty" };
  }
  let working = trimmed.replace(/\$/g, "").replace(/,/g, "").trim();
  if (working.startsWith("-")) {
    return { ok: false, message: "Negative amounts are not allowed" };
  }
  working = working.replace(/\s+/g, "");
  if (!/^\d+(\.\d+)?$/.test(working)) {
    return { ok: false, message: `Unrecognized amount: ${raw}` };
  }
  const [wholePart, fractionPart] = working.split(".") as [string, string | undefined];
  const whole = wholePart === "" ? "0" : wholePart;
  if (!/^\d+$/.test(whole)) {
    return { ok: false, message: `Unrecognized amount: ${raw}` };
  }
  let fractionDigits = "";
  if (fractionPart !== undefined) {
    if (!/^\d+$/.test(fractionPart) || fractionPart.length > 2) {
      return { ok: false, message: `Use at most two decimal places: ${raw}` };
    }
    fractionDigits = fractionPart.padEnd(2, "0").slice(0, 2);
  } else {
    fractionDigits = "00";
  }
  const combined = `${whole}${fractionDigits}`;
  const cents = Number.parseInt(combined, 10);
  if (!Number.isFinite(cents) || cents < 0) {
    return { ok: false, message: `Amount out of range: ${raw}` };
  }
  return { ok: true, cents };
}

function parseFeeDueAmountToCents(raw: string): { ok: true; cents: number; assumedZero: boolean } | { ok: false; message: string } {
  if (!raw.trim()) {
    return { ok: true, cents: 0, assumedZero: true };
  }
  const parsed = parseMoneyAmountToCents(raw);
  return parsed.ok ? { ...parsed, assumedZero: false } : parsed;
}

function parseFeePaidAmountToCents(raw: string): { ok: true; cents: number } | { ok: false; message: string } {
  if (!raw.trim()) {
    return { ok: true, cents: 0 };
  }
  return parseMoneyAmountToCents(raw);
}

export function normalizedCamperNameKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
}

export type CamperFeeMatchRow = { id: string; paymentStatus: CamperPaymentStatus };

/**
 * After persisting feeDueCents / feePaidCents from a fee CSV:
 * - When fee due is zero: do not change payment status from amounts (rows with due 0 and paid ≠ 0 are rejected earlier).
 * - Fully paid (paid ≥ due, due > 0): set paid_cash only if currently unpaid (offline settlement).
 * - Underpaid (paid < due): set unpaid unless currently paid_stripe (never downgrade Stripe from a spreadsheet).
 */
export function resolvePaymentStatusAfterFeeImport(
  current: CamperPaymentStatus,
  feeDueCents: number,
  feePaidCents: number,
): CamperPaymentStatus {
  if (feeDueCents === 0) {
    return current;
  }
  if (feePaidCents >= feeDueCents) {
    if (current === CamperPaymentStatus.unpaid) {
      return CamperPaymentStatus.paid_cash;
    }
    return current;
  }
  if (current === CamperPaymentStatus.paid_stripe) {
    return current;
  }
  return CamperPaymentStatus.unpaid;
}

export type CamperFeePreviewRow = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  rawSubset: Record<string, string>;
  camperId: string | null;
  feeDueCents: number | null;
  feePaidCents: number | null;
};

export type CamperFeeCommitPayload = {
  camperId: string;
  feeDueCents: number;
  feePaidCents: number;
  paymentStatus: CamperPaymentStatus;
};

export type CamperFeeImportPreviewResult = {
  headers: string[];
  suggestedColumnMap: CamperFeeColumnMap;
  columnMap: CamperFeeColumnMap;
  mapError: string | null;
  previewRows: CamperFeePreviewRow[];
  validRowCount: number;
  invalidRowCount: number;
  payloads: CamperFeeCommitPayload[];
  rowWarningsFlat: string[];
  globalWarnings: string[];
};

function buildNameIndex(
  campers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    paymentStatus: CamperPaymentStatus;
  }>,
): Map<string, CamperFeeMatchRow[]> {
  const map = new Map<string, CamperFeeMatchRow[]>();
  for (const camper of campers) {
    const key = normalizedCamperNameKey(camper.firstName, camper.lastName);
    const row: CamperFeeMatchRow = { id: camper.id, paymentStatus: camper.paymentStatus };
    const list = map.get(key);
    if (list) {
      list.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

export function runCamperFeeImportPreview(
  csvText: string,
  columnMapOverrides: Record<string, string | null | undefined> | undefined,
  campers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    paymentStatus: CamperPaymentStatus;
  }>,
): CamperFeeImportPreviewResult {
  const globalWarnings: string[] = [];
  const { headers, rows } = parseCsvRows(csvText);
  const suggested = suggestCamperFeeColumnMap(headers);
  const columnMap = mergeCamperFeeColumnMap(suggested, columnMapOverrides);
  const mapError = headers.length === 0 ? "CSV has no data rows." : validateCamperFeeColumnMap(headers, columnMap);

  const matchIndex = buildNameIndex(campers);

  if (mapError || rows.length === 0) {
    return {
      headers,
      suggestedColumnMap: suggested,
      columnMap,
      mapError,
      previewRows: [],
      validRowCount: 0,
      invalidRowCount: rows.length,
      payloads: [],
      rowWarningsFlat: [],
      globalWarnings:
        rows.length === 0 && headers.length === 0 ? ["CSV has no data rows."] : globalWarnings,
    };
  }

  const previewRows: CamperFeePreviewRow[] = [];
  const payloads: CamperFeeCommitPayload[] = [];
  const rowWarningsFlat: string[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawSubset: Record<string, string> = {};

    const take = (key: CamperFeeColumnKey): string => {
      const header = columnMap[key];
      const value = cell(raw, header ?? null);
      if (header) {
        rawSubset[header] = value;
      }
      return value;
    };

    const firstName = take("firstName");
    const lastName = take("lastName");
    const feeDueRaw = take("feeDue");
    const feePaidRaw = take("feePaid");

    if (!firstName.trim()) {
      errors.push("First name is required.");
    }
    if (!lastName.trim()) {
      errors.push("Last name is required.");
    }

    const dueParsed = parseFeeDueAmountToCents(feeDueRaw);
    if (!dueParsed.ok) {
      errors.push(`Fees due: ${dueParsed.message}`);
    }
    const paidParsed = parseFeePaidAmountToCents(feePaidRaw);
    if (!paidParsed.ok) {
      errors.push(`Fees paid: ${paidParsed.message}`);
    }

    let feeDueCents: number | null = null;
    let feePaidCents: number | null = null;
    if (dueParsed.ok && paidParsed.ok) {
      feeDueCents = dueParsed.cents;
      feePaidCents = paidParsed.cents;
      if (dueParsed.assumedZero) {
        warnings.push("Fees due is empty; importing will assume fees due is $0.00.");
      }
      if (feeDueCents === 0 && feePaidCents !== 0) {
        errors.push("Fee due is zero but fee paid is not; fix the row or use a non-zero fee due.");
      } else if (feeDueCents === 0 && feePaidCents === 0) {
        warnings.push("Fee due is zero; payment status will not be changed from fee amounts.");
      }
    }

    let camperId: string | null = null;
    if (!firstName.trim() || !lastName.trim()) {
      // skip match errors
    } else if (dueParsed.ok && paidParsed.ok && !(feeDueCents === 0 && feePaidCents !== 0)) {
      const key = normalizedCamperNameKey(firstName, lastName);
      const matches = matchIndex.get(key) ?? [];
      if (matches.length === 0) {
        errors.push("No camper matches this first and last name for this camp year.");
      } else if (matches.length > 1) {
        errors.push(`Ambiguous match: ${matches.length} campers share this name; resolve duplicates first.`);
      } else {
        camperId = matches[0].id;
      }
    }

    previewRows.push({
      rowNumber,
      errors,
      warnings,
      rawSubset,
      camperId,
      feeDueCents,
      feePaidCents,
    });

    for (const warning of warnings) {
      rowWarningsFlat.push(`Row ${rowNumber}: ${warning}`);
    }

    if (
      errors.length === 0 &&
      camperId &&
      feeDueCents !== null &&
      feePaidCents !== null
    ) {
      const camper = campers.find((c) => c.id === camperId);
      if (camper) {
        const paymentStatus = resolvePaymentStatusAfterFeeImport(
          camper.paymentStatus,
          feeDueCents,
          feePaidCents,
        );
        payloads.push({
          camperId,
          feeDueCents,
          feePaidCents,
          paymentStatus,
        });
      }
    }
  });

  const invalidRowCount = previewRows.filter((row) => row.errors.length > 0).length;
  return {
    headers,
    suggestedColumnMap: suggested,
    columnMap,
    mapError: null,
    previewRows,
    validRowCount: payloads.length,
    invalidRowCount,
    payloads,
    rowWarningsFlat,
    globalWarnings,
  };
}
