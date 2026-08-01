import { describe, expect, it } from "vitest";
import {
  agreementSnapshot,
  CAMPER_T_SHIRT_SIZES,
  camperRequiresMedicalConsent,
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

  it("accepts adult self-registration and rejects self-registration for a minor", () => {
    const adult = validFamilySubmission();
    adult.registrationType = "self";
    adult.guardian = {
      ...adult.guardian,
      fullName: "Taylor Camper",
      relationship: "Self",
    };
    adult.campers[0] = {
      ...adult.campers[0]!,
      dateOfBirth: "1999-05-04",
      guardianName: "Taylor Camper",
      guardianPhone: adult.guardian.phone,
    };
    adult.legal = null;
    expect(familySubmissionSchema.safeParse(adult).success).toBe(true);

    adult.campers.push({ ...adult.campers[0]! });
    expect(familySubmissionSchema.safeParse(adult).success).toBe(false);
    adult.campers.pop();

    adult.campers[0]!.dateOfBirth = new Date().toISOString().slice(0, 10);
    const result = familySubmissionSchema.safeParse(adult);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("at least 18"))).toBe(true);
    }
  });

  it("allows the camp-specific persistence layer to enforce whether authorization is required", () => {
    const input = validFamilySubmission();
    input.legal = null;
    expect(familySubmissionSchema.safeParse(input).success).toBe(true);
  });

  it("uses age on the first day of camp and exempts campers on their eighteenth birthday", () => {
    const campStartDate = new Date("2026-08-01T12:00:00.000Z");
    expect(camperRequiresMedicalConsent("2008-08-02", campStartDate)).toBe(true);
    expect(camperRequiresMedicalConsent("2008-08-01", campStartDate)).toBe(false);
    expect(camperRequiresMedicalConsent("2000-01-01", campStartDate)).toBe(false);
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
