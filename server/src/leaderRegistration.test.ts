import { describe, expect, it } from "vitest";
import {
  LEADER_MARITAL_STATUSES,
  LEADER_T_SHIRT_SIZES,
  leaderSubmissionDigest,
  leaderSubmissionSchema,
  type LeaderSubmission,
} from "./lib/leaderRegistration.js";

function validLeaderSubmission(): LeaderSubmission {
  return {
    submissionKey: "5a5f4447-aa8e-4fb1-821e-c566d8038fcb",
    email: "leader@example.test",
    firstName: "Taylor",
    lastName: "Leader",
    dateOfBirth: "1980-01-02",
    gender: "female",
    cellPhone: "5551234567",
    altPhone: null,
    streetAddress: "1 Camp Road",
    city: "Lebanon",
    stateOrProvince: "PA",
    postalCode: "17042",
    country: "United States",
    maritalStatus: "Married",
    faithServingResponse: "Faithfully serving for twenty years.",
    churchName: "Bible Church",
    pastorName: "Pastor Example",
    pastorPhone: "5559876543",
    ageGroupPreference: "10-13",
    tShirtSize: "L",
  };
}

describe("leader registration contract", () => {
  it("accepts every field represented in the historical leader CSV", () => {
    expect(leaderSubmissionSchema.safeParse(validLeaderSubmission()).success).toBe(true);
  });

  it("requires leader-only marital status and preferred age group fields", () => {
    const missingMaritalStatus = { ...validLeaderSubmission(), maritalStatus: "" };
    const missingAgeGroup = { ...validLeaderSubmission(), ageGroupPreference: "" };
    expect(leaderSubmissionSchema.safeParse(missingMaritalStatus).success).toBe(false);
    expect(leaderSubmissionSchema.safeParse(missingAgeGroup).success).toBe(false);
  });

  it("suggests historical marital statuses and keeps approved shirt sizes", () => {
    expect(LEADER_MARITAL_STATUSES).toEqual(["Single", "Married"]);
    expect(LEADER_T_SHIRT_SIZES).toEqual([
      "Not interested", "XS", "S", "M", "L", "XL", "XXL", "XXXL or larger",
    ]);
    expect(leaderSubmissionSchema.safeParse({
      ...validLeaderSubmission(),
      maritalStatus: "Widowed",
    }).success).toBe(true);
  });

  it("has a stable idempotency digest", () => {
    expect(leaderSubmissionDigest(validLeaderSubmission()))
      .toBe(leaderSubmissionDigest(validLeaderSubmission()));
  });
});
