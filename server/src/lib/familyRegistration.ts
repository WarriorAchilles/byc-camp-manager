import { createHash } from "node:crypto";
import { z } from "zod";

export const FAMILY_RESERVATION_MINUTES = 30;

export const MEDICAL_AGREEMENT_VERSION = "byc-medical-authorization-2026-07-11";

export const MEDICAL_AGREEMENT_TEXT =
  "This is to give Douglas Severt consent to sign for EMERGENCY MEDICAL and/or SURGICAL TREATMENT for the camper(s) listed in this registration.";

export const LEGAL_ACKNOWLEDGMENT_TEXT =
  "I am the parent or legal guardian authorized to provide this consent, agree to use electronic records, and intend my typed name to be my legal electronic signature.";

export const CAMPER_GENDERS = ["male", "female"] as const;

export const CAMPER_T_SHIRT_SIZES = [
  "Not interested",
  "Adult XS",
  "Adult S",
  "Adult M",
  "Adult L",
  "Adult XL",
  "Adult XXL",
  "Youth S",
  "Youth M",
  "Youth L",
  "Youth XL",
  "Other",
] as const;

export const STATE_PROVINCE_OPTIONS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC", "GU", "PR", "NL", "PE", "NS", "NB", "QC", "ON", "MB",
  "SK", "AB", "BC", "YT", "NT", "NU",
] as const;

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const digits = z.string().regex(/^\d{10,15}$/, "Use 10 to 15 digits only");
const optionalDigits = z.string().regex(/^\d{10,15}$/, "Use 10 to 15 digits only").optional().nullable();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((value) => {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid date");

const addressSchema = z.object({
  streetAddress: requiredText(200),
  city: requiredText(100),
  stateOrProvince: z.enum(STATE_PROVINCE_OPTIONS),
  postalCode: requiredText(20),
  country: requiredText(100),
}).strict();

const camperSchema = z.object({
  firstName: requiredText(100),
  lastName: requiredText(100),
  middleName: optionalText(100),
  dateOfBirth: dateOnly,
  gender: z.enum(CAMPER_GENDERS),
  useFamilyAddress: z.boolean(),
  address: addressSchema.optional().nullable(),
  camperCellPhone: optionalDigits,
  guardianName: requiredText(200),
  guardianPhone: digits,
  identifiesAsChristian: z.boolean(),
  receivedHolyGhost: z.boolean(),
  churchName: requiredText(200),
  pastorName: requiredText(200),
  tShirtIntent: z.enum(CAMPER_T_SHIRT_SIZES),
  medicalNotes: optionalText(4_000),
  allergies: optionalText(4_000),
  medications: optionalText(4_000),
  dietaryRestrictions: optionalText(4_000),
  emergencyContactName: requiredText(200),
  emergencyContactPhone: digits,
  specialNeeds: optionalText(4_000),
}).strict().superRefine((camper, ctx) => {
  if (!camper.useFamilyAddress && !camper.address) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "Camper address is required" });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (camper.dateOfBirth > today) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOfBirth"], message: "Date of birth cannot be in the future" });
  }
});

export const familySubmissionSchema = z.object({
  submissionKey: z.string().uuid(),
  guardian: z.object({
    fullName: requiredText(200),
    email: z.string().trim().email().max(320),
    phone: digits,
    relationship: requiredText(100),
    address: addressSchema,
  }).strict(),
  campers: z.array(camperSchema).min(1).max(12),
  legal: z.object({
    typedName: requiredText(200),
    acknowledged: z.literal(true),
    agreementVersion: z.literal(MEDICAL_AGREEMENT_VERSION),
  }).strict(),
}).strict();

export type FamilySubmission = z.infer<typeof familySubmissionSchema>;

export function agreementSnapshot(camperNames: string[]): string {
  return [
    MEDICAL_AGREEMENT_TEXT,
    `Covered camper(s): ${camperNames.join(", ")}.`,
    LEGAL_ACKNOWLEDGMENT_TEXT,
  ].join("\n\n");
}

export function submissionDigest(input: FamilySubmission): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function safeRequestIp(value: string | undefined): string {
  const candidate = (value ?? "unknown").trim();
  return /^[0-9a-f:.]{1,64}$/i.test(candidate) ? candidate : "unknown";
}
