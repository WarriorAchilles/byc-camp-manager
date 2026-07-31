import prismaClientPkg, {
  type DormGenderDesignation as DormGenderDesignationType,
  type DormPurpose as DormPurposeType,
  type Gender as GenderType,
} from "@prisma/client";

const { DormGenderDesignation, DormPurpose, Gender } = prismaClientPkg;

/** Age in full years at camp start (UTC calendar dates). */
export function ageOnCampStartUtc(dateOfBirth: Date, campStart: Date): number {
  let age = campStart.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = campStart.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && campStart.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function camperDormGenderMatches(
  designation: DormGenderDesignationType,
  gender: GenderType,
): boolean {
  if (designation === DormGenderDesignation.boys) {
    return gender === Gender.male;
  }
  if (designation === DormGenderDesignation.girls) {
    return gender === Gender.female;
  }
  return false;
}

export function workerDormGenderMatches(
  designation: DormGenderDesignationType,
  gender: GenderType,
): boolean {
  if (designation === DormGenderDesignation.co_ed) {
    return true;
  }
  return camperDormGenderMatches(designation, gender);
}

export function ageFitsBracket(age: number, minAge: number, maxAge: number | null): boolean {
  return age >= minAge && (maxAge === null || age <= maxAge);
}

export type DormBracketSlice = { minAge: number; maxAge: number | null; sortOrder: number };

export type CamperDormForAuto = {
  id: string;
  gender: GenderType;
  dateOfBirth: Date;
  lastName: string;
  firstName: string;
};

export type WorkerDormForAuto = {
  id: string;
  gender: GenderType;
  lastName: string;
  firstName: string;
};

export type CamperDormSlot = {
  id: string;
  name: string;
  purpose: DormPurposeType;
  genderDesignation: DormGenderDesignationType;
  camperCapacity: number;
  ageGroupBracket: DormBracketSlice | null;
};

export type WorkerDormSlot = {
  id: string;
  name: string;
  purpose: DormPurposeType;
  genderDesignation: DormGenderDesignationType;
  bedCapacity: number;
};

/** Camper dorms without an age bracket never receive auto-assignment (manual placement only). */
export function autoAssignCampersGreedy(
  campersWithoutDorm: CamperDormForAuto[],
  dormCurrentCounts: Map<string, number>,
  camperDorms: CamperDormSlot[],
  campStart: Date,
): { camperId: string; dormId: string }[] {
  const counts = new Map(dormCurrentCounts);
  const sortedCampers = [...campersWithoutDorm].sort((left, right) => {
    const last = left.lastName.localeCompare(right.lastName);
    if (last !== 0) {
      return last;
    }
    const first = left.firstName.localeCompare(right.firstName);
    if (first !== 0) {
      return first;
    }
    return left.id.localeCompare(right.id);
  });

  const sortedDorms = [...camperDorms]
    .filter((dorm) => dorm.purpose === DormPurpose.camper && dorm.ageGroupBracket !== null)
    .sort((left, right) => {
      const orderLeft = left.ageGroupBracket?.sortOrder ?? 0;
      const orderRight = right.ageGroupBracket?.sortOrder ?? 0;
      if (orderLeft !== orderRight) {
        return orderLeft - orderRight;
      }
      return left.name.localeCompare(right.name);
    });

  const result: { camperId: string; dormId: string }[] = [];
  for (const camper of sortedCampers) {
    const age = ageOnCampStartUtc(camper.dateOfBirth, campStart);
    for (const dorm of sortedDorms) {
      if (!camperDormGenderMatches(dorm.genderDesignation, camper.gender)) {
        continue;
      }
      const bracket = dorm.ageGroupBracket;
      if (!bracket || !ageFitsBracket(age, bracket.minAge, bracket.maxAge)) {
        continue;
      }
      const used = counts.get(dorm.id) ?? 0;
      if (used >= dorm.camperCapacity) {
        continue;
      }
      result.push({ camperId: camper.id, dormId: dorm.id });
      counts.set(dorm.id, used + 1);
      break;
    }
  }
  return result;
}

export function autoAssignWorkersGreedy(
  workersWithoutDorm: WorkerDormForAuto[],
  dormCurrentCounts: Map<string, number>,
  workerDorms: WorkerDormSlot[],
): { workerId: string; dormId: string }[] {
  const counts = new Map(dormCurrentCounts);
  const sortedWorkers = [...workersWithoutDorm].sort((left, right) => {
    const last = left.lastName.localeCompare(right.lastName);
    if (last !== 0) {
      return last;
    }
    const first = left.firstName.localeCompare(right.firstName);
    if (first !== 0) {
      return first;
    }
    return left.id.localeCompare(right.id);
  });

  const sortedDorms = [...workerDorms]
    .filter((dorm) => dorm.purpose === DormPurpose.worker)
    .sort((left, right) => left.name.localeCompare(right.name));

  const result: { workerId: string; dormId: string }[] = [];
  for (const worker of sortedWorkers) {
    for (const dorm of sortedDorms) {
      if (!workerDormGenderMatches(dorm.genderDesignation, worker.gender)) {
        continue;
      }
      const used = counts.get(dorm.id) ?? 0;
      if (used >= dorm.bedCapacity) {
        continue;
      }
      result.push({ workerId: worker.id, dormId: dorm.id });
      counts.set(dorm.id, used + 1);
      break;
    }
  }
  return result;
}

export function warningsAfterCamperAssignedToCamperDorm(input: {
  camperGender: GenderType;
  camperAge: number;
  dormGender: DormGenderDesignationType;
  dormBracket: DormBracketSlice | null;
}): string[] {
  const warnings: string[] = [];
  if (!camperDormGenderMatches(input.dormGender, input.camperGender)) {
    warnings.push("Gender does not match this dorm designation; assignment saved as an exception.");
  }
  if (
    input.dormBracket &&
    !ageFitsBracket(input.camperAge, input.dormBracket.minAge, input.dormBracket.maxAge)
  ) {
    warnings.push("Camper age is outside this dorm age group; assignment saved as an exception.");
  }
  return warnings;
}

export function warningsAfterWorkerAssignedToWorkerDorm(input: {
  workerGender: GenderType;
  dormGender: DormGenderDesignationType;
}): string[] {
  if (input.dormGender === DormGenderDesignation.co_ed) {
    return [];
  }
  if (!workerDormGenderMatches(input.dormGender, input.workerGender)) {
    return ["Gender does not match this dorm; assignment saved as an exception."];
  }
  return [];
}

export function assertCamperDormPurpose(dormPurpose: DormPurposeType): "ok" | "invalid" {
  return dormPurpose === DormPurpose.camper ? "ok" : "invalid";
}

export function assertWorkerDormPurpose(dormPurpose: DormPurposeType): "ok" | "invalid" {
  return dormPurpose === DormPurpose.worker ? "ok" : "invalid";
}

export function isCamperDormCoEdDisallowed(
  purpose: DormPurposeType,
  genderDesignation: DormGenderDesignationType,
): boolean {
  return purpose === DormPurpose.camper && genderDesignation === DormGenderDesignation.co_ed;
}
