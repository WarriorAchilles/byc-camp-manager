import { createHash } from "node:crypto";
import { z } from "zod";

export const WORKER_GENDERS = ["male", "female"] as const;

export const WORKER_STATE_PROVINCE_OPTIONS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC", "PR", "ON", "QC", "NS", "NB", "MB", "BC", "PE", "SK",
  "AB", "NL", "Other",
] as const;

export const WORKER_TASK_OPTIONS = [
  "Kitchen",
  "Snack Bar",
  "Serving Lines",
  "Cleaning Crew",
  "Sports and Recreation",
  "Hair Clinic",
  "Crafts",
  "Medical Nurse",
  "Night Watch (pre-approval required)",
  "Administrative duties (pre-approval required)",
] as const;

export const WORKER_T_SHIRT_SIZES = [
  "Not interested",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL or larger",
] as const;

export const WORKER_TASK_GUIDANCE =
  "Task assignments are based on camp need and are not guaranteed to follow preferences. Hair Clinic, Crafts, and Serving Lines are not full-time duties, so workers selecting them may receive additional assignments.";

export const WORKER_T_SHIRT_GUIDANCE =
  "Worker shirts are unisex and may run large on smaller frames. Shirts are sold online and in person; this registration records your size but does not collect payment.";

export const WORKER_CONFIRMATION_GUIDANCE = {
  testimony:
    "All workers must provide a written testimony and a pastor's letter of recommendation. Submit them to the camp email, or ask your pastor to call the designated camp contact for a verbal recommendation.",
  rules:
    "Workers and leaders are expected to follow the same camp rules as campers, including the camp's current appearance and conduct expectations.",
  arrival:
    "After arriving at the physical check-in location, scan the posted self-check-in QR code to begin check-in.",
  payment:
    "Workers do not pay camp tuition through this registration. Any worker shirt purchase is handled separately online or in person.",
} as const;

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const digits = z.string().regex(/^\d{10,15}$/, "Use 10 to 15 digits only");
const optionalDigits = z.string().regex(/^\d{10,15}$/, "Use 10 to 15 digits only").optional().nullable();
const optionalDateOnly = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date")
  .optional()
  .nullable();

export const workerSubmissionSchema = z.object({
  submissionKey: z.string().uuid(),
  email: z.string().trim().email().max(320),
  firstName: requiredText(100),
  lastName: requiredText(100),
  dateOfBirth: optionalDateOnly,
  gender: z.enum(WORKER_GENDERS),
  cellPhone: digits,
  altPhone: optionalDigits,
  streetAddress: requiredText(200),
  city: requiredText(100),
  stateOrProvince: z.enum(WORKER_STATE_PROVINCE_OPTIONS),
  postalCode: requiredText(20),
  country: requiredText(100),
  faithServingResponse: requiredText(4_000),
  churchName: requiredText(200),
  pastorName: requiredText(200),
  pastorPhone: digits,
  taskPreferences: z.tuple([
    z.enum(WORKER_TASK_OPTIONS),
    z.enum(WORKER_TASK_OPTIONS),
    z.enum(WORKER_TASK_OPTIONS),
  ]),
  tShirtSize: z.enum(WORKER_T_SHIRT_SIZES).optional().nullable(),
}).strict().superRefine((submission, ctx) => {
  if (new Set(submission.taskPreferences).size !== submission.taskPreferences.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["taskPreferences"],
      message: "Choose three distinct task preferences",
    });
  }
  if (submission.dateOfBirth && submission.dateOfBirth > new Date().toISOString().slice(0, 10)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dateOfBirth"],
      message: "Date of birth cannot be in the future",
    });
  }
});

export type WorkerSubmission = z.infer<typeof workerSubmissionSchema>;

export function workerSubmissionDigest(input: WorkerSubmission): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function normalizedPhone(value: string): string {
  return value.replace(/\D/g, "");
}
