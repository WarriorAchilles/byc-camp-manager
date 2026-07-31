import { describe, expect, it } from "vitest";
import { ageFitsGroup, ageGroupPreferenceValue, formatAgeGroupRange } from "./ageGroups";

describe("age groups", () => {
  it("formats and matches a finite range", () => {
    const bracket = { minAge: 10, maxAge: 13 };

    expect(formatAgeGroupRange(bracket)).toBe("10–13");
    expect(ageGroupPreferenceValue(bracket)).toBe("10-13");
    expect(ageFitsGroup(13, bracket)).toBe(true);
    expect(ageFitsGroup(14, bracket)).toBe(false);
  });

  it("treats a missing maximum as open-ended", () => {
    const bracket = { minAge: 18, maxAge: null };

    expect(formatAgeGroupRange(bracket)).toBe("18+");
    expect(ageGroupPreferenceValue(bracket)).toBe("18+");
    expect(ageFitsGroup(18, bracket)).toBe(true);
    expect(ageFitsGroup(120, bracket)).toBe(true);
    expect(ageFitsGroup(17, bracket)).toBe(false);
  });
});
