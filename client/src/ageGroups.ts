export type AgeGroupBracket = {
  id: string;
  minAge: number;
  maxAge: number | null;
  sortOrder: number;
  isActive: boolean;
};

export function formatAgeGroupRange(
  bracket: Pick<AgeGroupBracket, "minAge" | "maxAge">,
): string {
  return bracket.maxAge === null
    ? `${bracket.minAge}+`
    : `${bracket.minAge}–${bracket.maxAge}`;
}

export function ageGroupPreferenceValue(
  bracket: Pick<AgeGroupBracket, "minAge" | "maxAge">,
): string {
  return bracket.maxAge === null
    ? `${bracket.minAge}+`
    : `${bracket.minAge}-${bracket.maxAge}`;
}

export function ageFitsGroup(
  age: number,
  bracket: Pick<AgeGroupBracket, "minAge" | "maxAge">,
): boolean {
  return age >= bracket.minAge && (bracket.maxAge === null || age <= bracket.maxAge);
}
