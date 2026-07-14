import { describe, expect, it } from "vitest";
import {
  agreementSnapshot,
  CAMPER_T_SHIRT_SIZES,
  familySubmissionSchema,
  safeRequestIp,
  STATE_PROVINCE_OPTIONS,
  submissionDigest,
} from "./lib/familyRegistration.js";
import { validFamilySubmission } from "./familyRegistrationTestData.js";

describe("family registration contract", () => {
  it("accepts required legacy fields and a shared family address", () => {
    expect(familySubmissionSchema.safeParse(validFamilySubmission()).success).toBe(true);
  });

  it("requires an override address when the family address is not used", () => {
    const input = validFamilySubmission();
    input.campers[0]!.useFamilyAddress = false;
    expect(familySubmissionSchema.safeParse(input).success).toBe(false);
    input.campers[0]!.address = { ...input.guardian.address };
    expect(familySubmissionSchema.safeParse(input).success).toBe(true);
  });

  it("rejects malformed phones, future dates, and missing repeated campers", () => {
    const badPhone = validFamilySubmission();
    badPhone.guardian.phone = "555-123-4567";
    expect(familySubmissionSchema.safeParse(badPhone).success).toBe(false);

    const futureDate = validFamilySubmission();
    futureDate.campers[0]!.dateOfBirth = "2999-01-01";
    expect(familySubmissionSchema.safeParse(futureDate).success).toBe(false);

    const noCampers = { ...validFamilySubmission(), campers: [] };
    expect(familySubmissionSchema.safeParse(noCampers).success).toBe(false);
  });

  it("keeps the legacy option lists and agreement snapshot stable", () => {
    expect(STATE_PROVINCE_OPTIONS).toContain("GU");
    expect(STATE_PROVINCE_OPTIONS).toContain("NU");
    expect(CAMPER_T_SHIRT_SIZES).toEqual([
      "Not interested", "Adult XS", "Adult S", "Adult M", "Adult L", "Adult XL",
      "Adult XXL", "Youth S", "Youth M", "Youth L", "Youth XL", "Other",
    ]);
    const snapshot = agreementSnapshot(["Taylor Camper", "Jordan Camper"]);
    expect(snapshot).toContain("EMERGENCY MEDICAL and/or SURGICAL TREATMENT");
    expect(snapshot).toContain("Taylor Camper, Jordan Camper");
  });

  it("creates a stable replay digest and stores only safe IP text", () => {
    expect(submissionDigest(validFamilySubmission())).toBe(submissionDigest(validFamilySubmission()));
    expect(safeRequestIp("2001:db8::1")).toBe("2001:db8::1");
    expect(safeRequestIp("forwarded by attacker")).toBe("unknown");
  });
});
