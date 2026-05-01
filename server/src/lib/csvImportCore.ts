import { parse } from "csv-parse/sync";

export type CsvImportKind = "camper" | "worker" | "dorm_leader";

/** Logical column ids used in column maps (API + UI). */
export const CAMPER_COLUMN_KEYS = [
  "firstName",
  "lastName",
  "middleName",
  "dateOfBirth",
  "gender",
  "streetAddress",
  "city",
  "stateOrProvince",
  "postalCode",
  "country",
  "camperCellPhone",
  "guardianName",
  "guardianEmail",
  "guardianPhone",
  "emergencyContactName",
  "emergencyContactPhone",
  "medications",
  "physicalLimitations",
  "medicalNotes",
  "dietaryRestrictions",
  "paymentStatus",
] as const;

export type CamperColumnKey = (typeof CAMPER_COLUMN_KEYS)[number];

/** Worker registrations include ranked task preferences and optional merch; dorm leaders do not. */
export const WORKER_COLUMN_KEYS = [
  "email",
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "cellPhone",
  "altPhone",
  "streetAddress",
  "city",
  "stateOrProvince",
  "postalCode",
  "country",
  "taskPreferences",
  "tShirtSize",
] as const;

export type WorkerColumnKey = (typeof WORKER_COLUMN_KEYS)[number];

/** Dorm leader identity + contact + optional age-group label only (no task-preference columns). */
export const DORM_LEADER_COLUMN_KEYS = [
  "email",
  "firstName",
  "lastName",
  "gender",
  "cellPhone",
  "altPhone",
  "roleLabel",
] as const;

export type DormLeaderColumnKey = (typeof DORM_LEADER_COLUMN_KEYS)[number];

export type ColumnMapForKind<K extends CsvImportKind> = K extends "camper"
  ? Partial<Record<CamperColumnKey, string | null>>
  : K extends "worker"
    ? Partial<Record<WorkerColumnKey, string | null>>
    : Partial<Record<DormLeaderColumnKey, string | null>>;

export function normalizeHeaderLabel(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function cell(raw: Record<string, string>, header: string | null | undefined): string {
  if (!header) {
    return "";
  }
  const value = raw[header];
  return value === undefined || value === null ? "" : String(value).trim();
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

export function parseCsvRows(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return { headers: [], rows: [] };
  }
  const rows = parse(trimmed, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  return { headers: Object.keys(rows[0]), rows };
}

function suggestCamperMap(headers: string[]): Record<CamperColumnKey, string | null> {
  const used = new Set<string>();
  const pick = (patterns: string[]) => {
    const header = findUnusedHeader(headers, patterns, used);
    if (header) {
      used.add(header);
    }
    return header;
  };
  return {
    firstName: pick(["first name (given", "first name", "given legal name", "camper first"]),
    lastName: pick(["last name", "surname"]),
    middleName: pick(["middle name", "middle initial"]),
    dateOfBirth: pick(["date of birth", "dob", "birth date"]),
    gender: pick(["gender", "sex"]),
    streetAddress: pick(["street address", "address (please make", "address line"]),
    city: pick(["city"]),
    stateOrProvince: pick(["state/province/territory", "state or province", "state"]),
    postalCode: pick(["zip code", "postal code", "zip"]),
    country: pick(["country (", "country"]),
    camperCellPhone: pick([
      "cell number (numercial",
      "cell number",
      "camper cell",
      "student cell",
    ]),
    guardianName: pick(["parent guardian name", "guardian name", "parent name"]),
    guardianEmail: pick(["parent/guardian e-mail", "guardian email", "email address"]),
    guardianPhone: pick([
      "parent/guardian contact number",
      "parent guardian contact",
      "guardian phone",
      "guardian contact number",
    ]),
    emergencyContactName: pick(["emergency contact name"]),
    emergencyContactPhone: pick(["emergency contact phone"]),
    medications: pick(["list any medications", "medications"]),
    physicalLimitations: pick(["list any physical limitations", "physical limitations"]),
    medicalNotes: pick(["allergies", "medical info", "medical notes", "health"]),
    dietaryRestrictions: pick(["dietary"]),
    paymentStatus: pick(["payment status", "paid", "fee status"]),
  };
}

function suggestWorkerMap(headers: string[]): Record<WorkerColumnKey, string | null> {
  const used = new Set<string>();
  const pick = (patterns: string[]) => {
    const header = findUnusedHeader(headers, patterns, used);
    if (header) {
      used.add(header);
    }
    return header;
  };
  return {
    email: pick(["email address", "email"]),
    firstName: pick(["first name"]),
    lastName: pick(["last name"]),
    dateOfBirth: pick(["date of birth", "dob"]),
    gender: pick(["gender"]),
    cellPhone: pick(["cell number", "mobile"]),
    altPhone: pick(["alt. number", "alternate"]),
    streetAddress: pick(["street address"]),
    city: pick(["city"]),
    stateOrProvince: pick(["state or province", "state/province"]),
    postalCode: pick(["zip code", "postal"]),
    country: pick(["country (usa", "country"]),
    taskPreferences: pick([
      "there are a variety of positions",
      "preferred tasks",
      "top 3 preferred",
    ]),
    tShirtSize: pick(["t-shirts will be available", "t-shirt", "shirt size"]),
  };
}

function suggestDormLeaderMap(headers: string[]): Record<DormLeaderColumnKey, string | null> {
  const used = new Set<string>();
  const pick = (patterns: string[]) => {
    const header = findUnusedHeader(headers, patterns, used);
    if (header) {
      used.add(header);
    }
    return header;
  };
  return {
    email: pick(["email address", "email"]),
    firstName: pick(["first name"]),
    lastName: pick(["last name"]),
    gender: pick(["gender"]),
    cellPhone: pick(["cell number"]),
    altPhone: pick(["alt. number", "alternate"]),
    roleLabel: pick([
      "which age group would you prefer to work with",
      "which age group would you prefer",
    ]),
  };
}

export function suggestColumnMap(
  kind: CsvImportKind,
  headers: string[],
): Record<string, string | null> {
  if (kind === "camper") {
    return suggestCamperMap(headers);
  }
  if (kind === "worker") {
    return suggestWorkerMap(headers);
  }
  return suggestDormLeaderMap(headers);
}

export function mergeColumnMap(
  base: Record<string, string | null>,
  overrides: Record<string, string | null | undefined> | undefined,
): Record<string, string | null> {
  const merged = { ...base };
  if (!overrides) {
    return merged;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function allowedLogicalKeysForKind(kind: CsvImportKind): ReadonlySet<string> {
  if (kind === "camper") {
    return new Set(CAMPER_COLUMN_KEYS);
  }
  if (kind === "worker") {
    return new Set(WORKER_COLUMN_KEYS);
  }
  return new Set(DORM_LEADER_COLUMN_KEYS);
}

/** Drops keys from other import kinds (e.g. worker `taskPreferences` on a dorm-leader import). */
export function filterColumnMapOverridesForKind(
  kind: CsvImportKind,
  overrides: Record<string, string | null | undefined> | undefined,
): Record<string, string | null | undefined> | undefined {
  if (!overrides) {
    return undefined;
  }
  const allowed = allowedLogicalKeysForKind(kind);
  const filtered: Record<string, string | null | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function validateColumnMapHeaders(
  headers: string[],
  columnMap: Record<string, string | null>,
): string | null {
  const headerSet = new Set(headers);
  for (const [logical, fileHeader] of Object.entries(columnMap)) {
    if (fileHeader === null || fileHeader === "") {
      continue;
    }
    if (!headerSet.has(fileHeader)) {
      return `Column map for "${logical}" references unknown header "${fileHeader}"`;
    }
  }
  return null;
}

export function parseFlexibleDate(raw: string): { ok: true; iso: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Date of birth is empty" };
  }
  const isoLike = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoLike) {
    const year = Number(isoLike[1]);
    const month = Number(isoLike[2]);
    const day = Number(isoLike[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return { ok: false, message: `Invalid date: ${raw}` };
    }
    return { ok: true, iso: trimmed };
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const year = Number(slash[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      month < 1 ||
      month > 12
    ) {
      return { ok: false, message: `Invalid date: ${raw}` };
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return { ok: true, iso: `${year}-${mm}-${dd}` };
  }
  return { ok: false, message: `Unrecognized date format: ${raw}` };
}

export function parseGender(raw: string): { ok: true; value: "male" | "female" } | { ok: false; message: string } {
  const t = raw.trim().toLowerCase();
  if (!t) {
    return { ok: false, message: "Gender is required" };
  }
  if (t === "male" || t === "m") {
    return { ok: true, value: "male" };
  }
  if (t === "female" || t === "f") {
    return { ok: true, value: "female" };
  }
  return { ok: false, message: `Unrecognized gender: ${raw}` };
}

export function normalizePhoneDigits(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return { ok: false, message: "Phone number is empty" };
  }
  let normalized = digits;
  if (normalized.length === 11 && normalized.startsWith("1")) {
    normalized = normalized.slice(1);
  }
  if (normalized.length < 10) {
    return { ok: false, message: "Phone number must have at least 10 digits" };
  }
  return { ok: true, value: normalized };
}

export function parsePaymentStatus(raw: string): {
  value: "unpaid" | "paid_stripe" | "paid_cash";
  warning?: string;
} {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!t) {
    return { value: "unpaid", warning: "Payment status missing; defaulted to unpaid" };
  }
  if (t === "unpaid" || t === "no" || t === "pending") {
    return { value: "unpaid" };
  }
  if (t === "paid_stripe" || t === "stripe" || t === "card" || t === "paid_online") {
    return { value: "paid_stripe" };
  }
  if (t === "paid_cash" || t === "cash" || t === "paid_cash" || t === "check") {
    return { value: "paid_cash" };
  }
  if (t === "paid") {
    return { value: "paid_stripe", warning: "Ambiguous payment status \"paid\"; assumed paid (Stripe-style)" };
  }
  return {
    value: "unpaid",
    warning: `Unknown payment status "${raw}"; defaulted to unpaid`,
  };
}

export function splitTaskPreferences(raw: string): [string | null, string | null, string | null] {
  if (!raw.trim()) {
    return [null, null, null];
  }
  const parts = raw
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return [
    parts[0] ?? null,
    parts.length > 1 ? parts[1] ?? null : null,
    parts.length > 2 ? parts[2] ?? null : null,
  ];
}

export type CamperImportPayload = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  dateOfBirth: string;
  gender: "male" | "female";
  streetAddress: string | null;
  city: string | null;
  stateOrProvince: string | null;
  postalCode: string | null;
  country: string | null;
  camperCellPhone: string | null;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  medicalNotes: string | null;
  dietaryRestrictions: string | null;
  paymentStatus: "unpaid" | "paid_stripe" | "paid_cash";
};

export type WorkerImportPayload = {
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
};

export type DormLeaderImportPayload = {
  firstName: string;
  lastName: string;
  gender: "male" | "female";
  email: string;
  phone: string;
  roleLabel: string | null;
};

export type PreviewRowResult = {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  rawSubset: Record<string, string>;
};

export type CamperPipelineResult = {
  previewRows: PreviewRowResult[];
  payloads: CamperImportPayload[];
  rowWarningsFlat: string[];
  globalWarnings: string[];
};

function combineMedicalNotes(
  raw: Record<string, string>,
  columnMap: Record<string, string | null>,
): { text: string | null; partsUsed: string[] } {
  const parts: string[] = [];
  const keys: Array<keyof typeof columnMap> = ["medicalNotes", "medications", "physicalLimitations"];
  const used: string[] = [];
  for (const key of keys) {
    const header = columnMap[key];
    const value = cell(raw, header ?? null);
    if (value) {
      parts.push(value);
      if (header) {
        used.push(header);
      }
    }
  }
  if (parts.length === 0) {
    return { text: null, partsUsed: used };
  }
  return { text: parts.join("\n"), partsUsed: used };
}

export function buildCamperImportPreview(
  rows: Record<string, string>[],
  columnMap: Record<string, string | null>,
): CamperPipelineResult {
  const previewRows: PreviewRowResult[] = [];
  const payloads: CamperImportPayload[] = [];
  const rowWarningsFlat: string[] = [];
  const globalWarnings: string[] = [];

  if (!columnMap.paymentStatus) {
    globalWarnings.push("Payment status column not mapped; rows default to unpaid where missing.");
  }

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawSubset: Record<string, string> = {};

    const take = (key: CamperColumnKey): string => {
      const header = columnMap[key];
      const value = cell(raw, header ?? null);
      if (header && value !== undefined) {
        rawSubset[header] = value;
      }
      return value;
    };

    const firstName = take("firstName");
    const lastName = take("lastName");
    const middleNameRaw = take("middleName");
    const dobRaw = take("dateOfBirth");
    const genderRaw = take("gender");
    const guardianName = take("guardianName");
    const guardianEmail = take("guardianEmail");
    let guardianPhoneRaw = take("guardianPhone");
    const camperCell = take("camperCellPhone");

    if (!guardianPhoneRaw.trim() && camperCell.trim()) {
      guardianPhoneRaw = camperCell;
      warnings.push("Guardian phone empty; used camper cell number instead.");
    }

    const medicalCombined = combineMedicalNotes(raw, columnMap);
    for (const header of medicalCombined.partsUsed) {
      rawSubset[header] = cell(raw, header);
    }

    const dietaryRaw = take("dietaryRestrictions");
    const paymentRaw = take("paymentStatus");

    if (!firstName.trim()) {
      errors.push("Camper first name is required.");
    }
    if (!lastName.trim()) {
      errors.push("Camper last name is required.");
    }

    const dobResult = parseFlexibleDate(dobRaw);
    if (!dobResult.ok) {
      errors.push(dobResult.message);
    }

    const genderResult = parseGender(genderRaw);
    if (!genderResult.ok) {
      errors.push(genderResult.message);
    }

    if (!guardianName.trim()) {
      errors.push("Parent or guardian name is required.");
    }

    if (!guardianEmail.trim()) {
      errors.push("Parent or guardian email is required.");
    } else {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail.trim());
      if (!emailOk) {
        errors.push("Parent or guardian email is not valid.");
      }
    }

    const phoneResult = normalizePhoneDigits(guardianPhoneRaw);
    if (!phoneResult.ok) {
      errors.push(`Parent or guardian phone: ${phoneResult.message}`);
    }

    if (!medicalCombined.text?.trim()) {
      errors.push("Allergies / medical info is required (map medications, limitations, or a combined medical column).");
    }

    const paymentParsed = parsePaymentStatus(paymentRaw);
    if (paymentParsed.warning) {
      warnings.push(paymentParsed.warning);
    }

    previewRows.push({ rowNumber, errors, warnings, rawSubset });

    for (const warning of warnings) {
      rowWarningsFlat.push(`Row ${rowNumber}: ${warning}`);
    }

    if (
      errors.length === 0 &&
      dobResult.ok &&
      genderResult.ok &&
      phoneResult.ok &&
      medicalCombined.text
    ) {
      payloads.push({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleNameRaw.trim() ? middleNameRaw.trim() : null,
        dateOfBirth: dobResult.iso,
        gender: genderResult.value,
        streetAddress: take("streetAddress").trim() || null,
        city: take("city").trim() || null,
        stateOrProvince: take("stateOrProvince").trim() || null,
        postalCode: take("postalCode").trim() || null,
        country: take("country").trim() || null,
        camperCellPhone: camperCell.trim() || null,
        guardianName: guardianName.trim(),
        guardianEmail: guardianEmail.trim().toLowerCase(),
        guardianPhone: phoneResult.value,
        emergencyContactName: take("emergencyContactName").trim() || null,
        emergencyContactPhone: (() => {
          const emergencyPhoneRaw = take("emergencyContactPhone");
          const normalized = normalizePhoneDigits(emergencyPhoneRaw);
          if (!emergencyPhoneRaw.trim()) {
            return null;
          }
          return normalized.ok ? normalized.value : null;
        })(),
        medicalNotes: medicalCombined.text.trim(),
        dietaryRestrictions: dietaryRaw.trim() || null,
        paymentStatus: paymentParsed.value,
      });
    }
  });

  return { previewRows, payloads, rowWarningsFlat, globalWarnings };
}

export function buildWorkerImportPreview(
  rows: Record<string, string>[],
  columnMap: Record<string, string | null>,
): {
  previewRows: PreviewRowResult[];
  payloads: WorkerImportPayload[];
  rowWarningsFlat: string[];
  globalWarnings: string[];
} {
  const previewRows: PreviewRowResult[] = [];
  const payloads: WorkerImportPayload[] = [];
  const rowWarningsFlat: string[] = [];
  const globalWarnings: string[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawSubset: Record<string, string> = {};

    const take = (key: WorkerColumnKey): string => {
      const header = columnMap[key];
      const value = cell(raw, header ?? null);
      if (header) {
        rawSubset[header] = value;
      }
      return value;
    };

    const email = take("email");
    const firstName = take("firstName");
    const lastName = take("lastName");
    const dobRaw = take("dateOfBirth");
    const genderRaw = take("gender");
    const cellRaw = take("cellPhone");
    const altRaw = take("altPhone");
    const street = take("streetAddress");
    const city = take("city");
    const state = take("stateOrProvince");
    const zip = take("postalCode");
    const country = take("country");
    const tasksRaw = take("taskPreferences");
    const shirt = take("tShirtSize");

    if (!email.trim()) {
      errors.push("Email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push("Email is not valid.");
    }
    if (!firstName.trim()) {
      errors.push("First name is required.");
    }
    if (!lastName.trim()) {
      errors.push("Last name is required.");
    }

    let dobIso: string | null = null;
    if (dobRaw.trim()) {
      const dobResult = parseFlexibleDate(dobRaw);
      if (!dobResult.ok) {
        errors.push(dobResult.message);
      } else {
        dobIso = dobResult.iso;
      }
    }

    const genderResult = parseGender(genderRaw);
    if (!genderResult.ok) {
      errors.push(genderResult.message);
    }

    const cellResult = normalizePhoneDigits(cellRaw);
    if (!cellResult.ok) {
      errors.push(`Cell phone: ${cellResult.message}`);
    }

    let altNormalized: string | null = null;
    if (altRaw.trim()) {
      const altResult = normalizePhoneDigits(altRaw);
      if (!altResult.ok) {
        warnings.push(`Alt phone ignored: ${altResult.message}`);
      } else {
        altNormalized = altResult.value;
      }
    }

    if (!street.trim()) {
      errors.push("Street address is required.");
    }
    if (!city.trim()) {
      errors.push("City is required.");
    }
    if (!state.trim()) {
      errors.push("State or province is required.");
    }
    if (!zip.trim()) {
      errors.push("Postal code is required.");
    }
    if (!country.trim()) {
      errors.push("Country is required.");
    }

    const [taskFirst, taskSecond, taskThird] = splitTaskPreferences(tasksRaw);
    if (tasksRaw.trim() && !taskFirst) {
      warnings.push("Could not parse task preferences.");
    }

    previewRows.push({ rowNumber, errors, warnings, rawSubset });
    for (const warning of warnings) {
      rowWarningsFlat.push(`Row ${rowNumber}: ${warning}`);
    }

    if (
      errors.length === 0 &&
      genderResult.ok &&
      cellResult.ok &&
      email.trim() &&
      firstName.trim() &&
      lastName.trim()
    ) {
      payloads.push({
        email: email.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth: dobIso,
        gender: genderResult.value,
        cellPhone: cellResult.value,
        altPhone: altNormalized,
        streetAddress: street.trim(),
        city: city.trim(),
        stateOrProvince: state.trim(),
        postalCode: zip.trim(),
        country: country.trim(),
        taskPreferenceFirst: taskFirst,
        taskPreferenceSecond: taskSecond,
        taskPreferenceThird: taskThird,
        tShirtSize: shirt.trim() || null,
      });
    }
  });

  return { previewRows, payloads, rowWarningsFlat, globalWarnings };
}

export function buildDormLeaderImportPreview(
  rows: Record<string, string>[],
  columnMap: Record<string, string | null>,
): {
  previewRows: PreviewRowResult[];
  payloads: DormLeaderImportPayload[];
  rowWarningsFlat: string[];
  globalWarnings: string[];
} {
  const previewRows: PreviewRowResult[] = [];
  const payloads: DormLeaderImportPayload[] = [];
  const rowWarningsFlat: string[] = [];
  const globalWarnings: string[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const rawSubset: Record<string, string> = {};

    const take = (key: DormLeaderColumnKey): string => {
      const header = columnMap[key];
      const value = cell(raw, header ?? null);
      if (header) {
        rawSubset[header] = value;
      }
      return value;
    };

    const email = take("email");
    const firstName = take("firstName");
    const lastName = take("lastName");
    const genderRaw = take("gender");
    const cellRaw = take("cellPhone");
    const altRaw = take("altPhone");
    const roleLabelRaw = take("roleLabel");

    if (!email.trim()) {
      errors.push("Email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.push("Email is not valid.");
    }
    if (!firstName.trim()) {
      errors.push("First name is required.");
    }
    if (!lastName.trim()) {
      errors.push("Last name is required.");
    }

    const genderResult = parseGender(genderRaw);
    if (!genderResult.ok) {
      errors.push(genderResult.message);
    }

    const phoneRaw = cellRaw.trim() ? cellRaw : altRaw;
    if (!cellRaw.trim() && altRaw.trim()) {
      warnings.push("Primary cell empty; used alternate number for phone.");
    }
    const phoneResult = normalizePhoneDigits(phoneRaw);
    if (!phoneResult.ok) {
      errors.push(`Phone: ${phoneResult.message}`);
    }

    previewRows.push({ rowNumber, errors, warnings, rawSubset });
    for (const warning of warnings) {
      rowWarningsFlat.push(`Row ${rowNumber}: ${warning}`);
    }

    if (errors.length === 0 && genderResult.ok && phoneResult.ok) {
      payloads.push({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        gender: genderResult.value,
        email: email.trim().toLowerCase(),
        phone: phoneResult.value,
        roleLabel: roleLabelRaw.trim() || null,
      });
    }
  });

  return { previewRows, payloads, rowWarningsFlat, globalWarnings };
}

export function runImportPreview(
  kind: CsvImportKind,
  csvText: string,
  columnMapOverrides: Record<string, string | null | undefined> | undefined,
): {
  headers: string[];
  suggestedColumnMap: Record<string, string | null>;
  columnMap: Record<string, string | null>;
  mapError: string | null;
  previewRows: PreviewRowResult[];
  validRowCount: number;
  invalidRowCount: number;
  payloads: CamperImportPayload[] | WorkerImportPayload[] | DormLeaderImportPayload[];
  rowWarningsFlat: string[];
  globalWarnings: string[];
} {
  const { headers, rows } = parseCsvRows(csvText);
  const suggested = suggestColumnMap(kind, headers);
  const overrides = filterColumnMapOverridesForKind(kind, columnMapOverrides);
  const columnMap = mergeColumnMap(suggested, overrides);
  const mapError = validateColumnMapHeaders(headers, columnMap);

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
      globalWarnings: rows.length === 0 && headers.length === 0 ? ["CSV has no data rows."] : [],
    };
  }

  if (kind === "camper") {
    const result = buildCamperImportPreview(rows, columnMap);
    const invalidRowCount = result.previewRows.filter((row) => row.errors.length > 0).length;
    return {
      headers,
      suggestedColumnMap: suggested,
      columnMap,
      mapError,
      previewRows: result.previewRows,
      validRowCount: result.payloads.length,
      invalidRowCount,
      payloads: result.payloads,
      rowWarningsFlat: result.rowWarningsFlat,
      globalWarnings: result.globalWarnings,
    };
  }

  if (kind === "worker") {
    const result = buildWorkerImportPreview(rows, columnMap);
    const invalidRowCount = result.previewRows.filter((row) => row.errors.length > 0).length;
    return {
      headers,
      suggestedColumnMap: suggested,
      columnMap,
      mapError,
      previewRows: result.previewRows,
      validRowCount: result.payloads.length,
      invalidRowCount,
      payloads: result.payloads,
      rowWarningsFlat: result.rowWarningsFlat,
      globalWarnings: result.globalWarnings,
    };
  }

  const result = buildDormLeaderImportPreview(rows, columnMap);
  const invalidRowCount = result.previewRows.filter((row) => row.errors.length > 0).length;
  return {
    headers,
    suggestedColumnMap: suggested,
    columnMap,
    mapError,
    previewRows: result.previewRows,
    validRowCount: result.payloads.length,
    invalidRowCount,
    payloads: result.payloads,
    rowWarningsFlat: result.rowWarningsFlat,
    globalWarnings: result.globalWarnings,
  };
}
