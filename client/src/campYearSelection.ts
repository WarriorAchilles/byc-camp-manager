/** Camp year shown first in staff dropdowns: keep prior choice, else org default, else first listed. */
export function resolveCampYearSelection(
  campYears: readonly { id: string }[],
  activeCampYearId: string | null | undefined,
  previousSelection: string,
): string {
  if (previousSelection && campYears.some((year) => year.id === previousSelection)) {
    return previousSelection;
  }
  if (activeCampYearId && campYears.some((year) => year.id === activeCampYearId)) {
    return activeCampYearId;
  }
  return campYears[0]?.id ?? "";
}

/** Same rules for configuration UI where an empty list yields null. */
export function resolveCampYearSelectionNullable(
  campYears: readonly { id: string }[],
  activeCampYearId: string | null | undefined,
  previousSelection: string | null,
): string | null {
  if (previousSelection && campYears.some((year) => year.id === previousSelection)) {
    return previousSelection;
  }
  if (activeCampYearId && campYears.some((year) => year.id === activeCampYearId)) {
    return activeCampYearId;
  }
  return campYears[0]?.id ?? null;
}
