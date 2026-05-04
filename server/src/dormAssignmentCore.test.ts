import { DormGenderDesignation, DormPurpose, Gender } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ageFitsBracket,
  ageOnCampStartUtc,
  assertCamperDormPurpose,
  assertWorkerDormPurpose,
  autoAssignCampersGreedy,
  autoAssignWorkersGreedy,
  camperDormGenderMatches,
  isCamperDormCoEdDisallowed,
  warningsAfterCamperAssignedToCamperDorm,
  warningsAfterWorkerAssignedToWorkerDorm,
  workerDormGenderMatches,
} from "./lib/dormAssignmentCore.js";

describe("dormAssignmentCore", () => {
  const campStart = new Date("2099-07-01T12:00:00.000Z");

  it("computes age on camp start in UTC", () => {
    expect(ageOnCampStartUtc(new Date("2010-07-02T00:00:00.000Z"), campStart)).toBe(88);
    expect(ageOnCampStartUtc(new Date("2010-07-01T00:00:00.000Z"), campStart)).toBe(89);
    expect(ageOnCampStartUtc(new Date("2010-06-30T00:00:00.000Z"), campStart)).toBe(89);
  });

  it("rejects co-ed designation for camper dorms", () => {
    expect(isCamperDormCoEdDisallowed(DormPurpose.camper, DormGenderDesignation.co_ed)).toBe(true);
    expect(isCamperDormCoEdDisallowed(DormPurpose.worker, DormGenderDesignation.co_ed)).toBe(false);
    expect(isCamperDormCoEdDisallowed(DormPurpose.camper, DormGenderDesignation.boys)).toBe(false);
  });

  it("matches camper dorm gender to camper sex", () => {
    expect(camperDormGenderMatches(DormGenderDesignation.boys, Gender.male)).toBe(true);
    expect(camperDormGenderMatches(DormGenderDesignation.boys, Gender.female)).toBe(false);
    expect(camperDormGenderMatches(DormGenderDesignation.girls, Gender.female)).toBe(true);
    expect(camperDormGenderMatches(DormGenderDesignation.co_ed, Gender.male)).toBe(false);
  });

  it("treats worker co-ed dorms as gender-neutral", () => {
    expect(workerDormGenderMatches(DormGenderDesignation.co_ed, Gender.male)).toBe(true);
    expect(workerDormGenderMatches(DormGenderDesignation.co_ed, Gender.female)).toBe(true);
  });

  it("auto-assigns campers in stable name order into first matching dorm with space", () => {
    const bracket = { minAge: 10, maxAge: 17, sortOrder: 1 };
    const dorms = [
      {
        id: "dorm-b",
        name: "B Cabin",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 1,
        ageGroupBracket: bracket,
      },
      {
        id: "dorm-a",
        name: "A Cabin",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 2,
        ageGroupBracket: bracket,
      },
    ];
    const campers = [
      {
        id: "c-z",
        gender: Gender.male,
        dateOfBirth: new Date("2085-06-01T00:00:00.000Z"),
        lastName: "Zed",
        firstName: "A",
      },
      {
        id: "c-a",
        gender: Gender.male,
        dateOfBirth: new Date("2085-06-01T00:00:00.000Z"),
        lastName: "Alpha",
        firstName: "B",
      },
    ];
    const counts = new Map<string, number>([
      ["dorm-a", 0],
      ["dorm-b", 0],
    ]);
    const result = autoAssignCampersGreedy(campers, counts, dorms, campStart);
    expect(result).toHaveLength(2);
    expect(result[0].camperId).toBe("c-a");
    expect(result[0].dormId).toBe("dorm-a");
    expect(result[1].camperId).toBe("c-z");
    expect(result[1].dormId).toBe("dorm-a");
  });

  it("orders camper dorms by age bracket sortOrder before name", () => {
    const bracketYoung = { minAge: 10, maxAge: 12, sortOrder: 1 };
    const bracketTeen = { minAge: 13, maxAge: 17, sortOrder: 2 };
    const dorms = [
      {
        id: "teen",
        name: "Z Teen",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 5,
        ageGroupBracket: bracketTeen,
      },
      {
        id: "young",
        name: "A Young",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 5,
        ageGroupBracket: bracketYoung,
      },
    ];
    const campers = [
      {
        id: "teen-boy",
        gender: Gender.male,
        dateOfBirth: new Date("2085-06-01T00:00:00.000Z"),
        lastName: "One",
        firstName: "X",
      },
    ];
    const counts = new Map([
      ["teen", 0],
      ["young", 0],
    ]);
    const result = autoAssignCampersGreedy(campers, counts, dorms, campStart);
    expect(result).toEqual([{ camperId: "teen-boy", dormId: "teen" }]);
  });

  it("skips dorms without age bracket for auto-assignment", () => {
    const dorms = [
      {
        id: "open",
        name: "Open",
        purpose: DormPurpose.camper,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 5,
        ageGroupBracket: null,
      },
    ];
    const campers = [
      {
        id: "c1",
        gender: Gender.male,
        dateOfBirth: new Date("2085-06-01T00:00:00.000Z"),
        lastName: "A",
        firstName: "B",
      },
    ];
    const result = autoAssignCampersGreedy(campers, new Map([["open", 0]]), dorms, campStart);
    expect(result).toHaveLength(0);
  });

  it("auto-assigns workers to single-gender worker dorms only when gender matches", () => {
    const dorms = [
      {
        id: "w-boys",
        name: "Staff Boys",
        purpose: DormPurpose.worker,
        genderDesignation: DormGenderDesignation.boys,
        bedCapacity: 2,
      },
    ];
    const workers = [
      { id: "w1", gender: Gender.male, lastName: "A", firstName: "B" },
      { id: "w2", gender: Gender.female, lastName: "C", firstName: "D" },
    ];
    const result = autoAssignWorkersGreedy(workers, new Map([["w-boys", 0]]), dorms);
    expect(result).toEqual([{ workerId: "w1", dormId: "w-boys" }]);
  });

  it("auto-assigns mixed genders into co-ed worker dorms", () => {
    const dorms = [
      {
        id: "co",
        name: "Family",
        purpose: DormPurpose.worker,
        genderDesignation: DormGenderDesignation.co_ed,
        bedCapacity: 5,
      },
    ];
    const workers = [
      { id: "m", gender: Gender.male, lastName: "A", firstName: "B" },
      { id: "f", gender: Gender.female, lastName: "C", firstName: "D" },
    ];
    const result = autoAssignWorkersGreedy(workers, new Map([["co", 0]]), dorms);
    expect(result.map((row) => row.workerId).sort()).toEqual(["f", "m"]);
  });

  it("warns on camper gender or age mismatch but role logic is API-side", () => {
    expect(
      warningsAfterCamperAssignedToCamperDorm({
        camperGender: Gender.female,
        camperAge: 14,
        dormGender: DormGenderDesignation.boys,
        dormBracket: { minAge: 13, maxAge: 17, sortOrder: 1 },
      }),
    ).toHaveLength(1);
    expect(
      warningsAfterCamperAssignedToCamperDorm({
        camperGender: Gender.male,
        camperAge: 10,
        dormGender: DormGenderDesignation.boys,
        dormBracket: { minAge: 13, maxAge: 17, sortOrder: 1 },
      }),
    ).toHaveLength(1);
    expect(
      warningsAfterCamperAssignedToCamperDorm({
        camperGender: Gender.male,
        camperAge: 14,
        dormGender: DormGenderDesignation.boys,
        dormBracket: { minAge: 13, maxAge: 17, sortOrder: 1 },
      }),
    ).toHaveLength(0);
  });

  it("does not warn for gender on co-ed worker dorms", () => {
    expect(
      warningsAfterWorkerAssignedToWorkerDorm({
        workerGender: Gender.female,
        dormGender: DormGenderDesignation.co_ed,
      }),
    ).toEqual([]);
  });

  it("blocks wrong purpose at type level in helpers", () => {
    expect(assertCamperDormPurpose(DormPurpose.worker)).toBe("invalid");
    expect(assertWorkerDormPurpose(DormPurpose.camper)).toBe("invalid");
  });

  it("age bracket inclusive bounds", () => {
    expect(ageFitsBracket(13, 13, 17)).toBe(true);
    expect(ageFitsBracket(17, 13, 17)).toBe(true);
    expect(ageFitsBracket(12, 13, 17)).toBe(false);
  });
});
