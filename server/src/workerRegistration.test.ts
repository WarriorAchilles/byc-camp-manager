import { describe, expect, it } from "vitest";
import {
  workerSubmissionDigest,
  workerSubmissionSchema,
  WORKER_CONFIRMATION_GUIDANCE,
  WORKER_STATE_PROVINCE_OPTIONS,
  WORKER_TASK_OPTIONS,
  WORKER_T_SHIRT_SIZES,
} from "./lib/workerRegistration.js";
import { validWorkerSubmission } from "./workerRegistrationTestData.js";

describe("worker registration contract", () => {
  it("accepts the required legacy worker fields", () => {
    expect(workerSubmissionSchema.safeParse(validWorkerSubmission()).success).toBe(true);
  });

  it("rejects missing required fields, malformed phones, and future birth dates", () => {
    const missingChurch = { ...validWorkerSubmission(), churchName: "" };
    expect(workerSubmissionSchema.safeParse(missingChurch).success).toBe(false);

    const malformedPhone = { ...validWorkerSubmission(), cellPhone: "555-123-4567" };
    expect(workerSubmissionSchema.safeParse(malformedPhone).success).toBe(false);

    const futureBirthDate = { ...validWorkerSubmission(), dateOfBirth: "2999-01-01" };
    expect(workerSubmissionSchema.safeParse(futureBirthDate).success).toBe(false);
  });

  it("requires three distinct ranked task preferences", () => {
    const duplicateTasks = validWorkerSubmission();
    duplicateTasks.taskPreferences = ["Kitchen", "Kitchen", "Crafts"];
    const parsed = workerSubmissionSchema.safeParse(duplicateTasks);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["taskPreferences"],
          message: "Choose three distinct task preferences",
        }),
      ]));
    }
  });

  it("keeps the approved legacy option lists exact", () => {
    expect(WORKER_STATE_PROVINCE_OPTIONS).toHaveLength(63);
    expect(WORKER_STATE_PROVINCE_OPTIONS).toEqual(expect.arrayContaining([
      "DC", "PR", "ON", "QC", "NS", "NB", "MB", "BC", "PE", "SK", "AB", "NL", "Other",
    ]));
    expect(WORKER_STATE_PROVINCE_OPTIONS).not.toContain("GU");
    expect(WORKER_TASK_OPTIONS).toEqual([
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
    ]);
    expect(WORKER_T_SHIRT_SIZES).toEqual([
      "Not interested", "XS", "S", "M", "L", "XL", "XXL", "XXXL or larger",
    ]);
  });

  it("has stable idempotency input and explicit no-tuition guidance", () => {
    expect(workerSubmissionDigest(validWorkerSubmission()))
      .toBe(workerSubmissionDigest(validWorkerSubmission()));
    expect(WORKER_CONFIRMATION_GUIDANCE.testimony).toContain("pastor's letter");
    expect(WORKER_CONFIRMATION_GUIDANCE.rules).toContain("same camp rules");
    expect(WORKER_CONFIRMATION_GUIDANCE.arrival).toContain("self-check-in QR code");
    expect(WORKER_CONFIRMATION_GUIDANCE.payment).toContain("do not pay camp tuition");
  });
});
