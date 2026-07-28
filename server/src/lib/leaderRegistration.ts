import { createHash } from "node:crypto";
import { z } from "zod";
import {
  WORKER_GENDERS,
  WORKER_STATE_PROVINCE_OPTIONS,
  WORKER_T_SHIRT_SIZES,
} from "./workerRegistration.js";

export const LEADER_GENDERS = WORKER_GENDERS;
export const LEADER_STATE_PROVINCE_OPTIONS = WORKER_STATE_PROVINCE_OPTIONS;
export const LEADER_MARITAL_STATUSES = ["Single", "Married"] as const;
export const LEADER_T_SHIRT_SIZES = WORKER_T_SHIRT_SIZES;

export const LEADER_T_SHIRT_GUIDANCE =
  "Leader shirts are unisex and may run large on smaller frames. Shirts are sold online and in person; this registration records your size but does not collect payment.";

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const digits = z.string().regex(/^\d{10,15}$/, "Use 10 to 15 digits only");
const optionalDigits = digits.optional().nullable();
const dateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date");

export const leaderSubmissionSchema = z.object({
  submissionKey: z.string().uuid(),
  email: z.string().trim().email().max(320),
  firstName: requiredText(100),
  lastName: requiredText(100),
  dateOfBirth: dateOnly,
  gender: z.enum(LEADER_GENDERS),
  cellPhone: digits,
  altPhone: optionalDigits,
  streetAddress: requiredText(200),
  city: requiredText(100),
  stateOrProvince: z.enum(LEADER_STATE_PROVINCE_OPTIONS),
  postalCode: requiredText(20),
  country: requiredText(100),
  maritalStatus: requiredText(100),
  faithServingResponse: requiredText(4_000),
  churchName: requiredText(200),
  pastorName: requiredText(200),
  selectedChurchId: z.string().uuid().optional().nullable(),
  pastorPhone: digits,
  ageGroupPreference: requiredText(100),
  tShirtSize: z.enum(LEADER_T_SHIRT_SIZES).optional().nullable(),
}).strict().superRefine((submission, ctx) => {
  if (submission.dateOfBirth > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateOfBirth"],
      message: "Date of birth cannot be in the future",
    });
  }
});

export type LeaderSubmission = z.infer<typeof leaderSubmissionSchema>;

export function leaderSubmissionDigest(input: LeaderSubmission): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
