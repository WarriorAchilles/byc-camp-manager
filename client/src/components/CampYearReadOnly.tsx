import type { CSSProperties, ReactElement } from "react";

export type CampYearListItem = { id: string; name: string; yearLabel: string };

type CampYearReadOnlyProps = {
  campYears: readonly CampYearListItem[];
  campYearId: string;
  /** When false, only the value line renders (parent supplies the "Camp year" label). */
  showLabel?: boolean;
  label?: string;
  className?: string;
  valueStyle?: CSSProperties;
};

export function CampYearReadOnly({
  campYears,
  campYearId,
  showLabel = true,
  label = "Camp year",
  className,
  valueStyle,
}: CampYearReadOnlyProps): ReactElement {
  const selected = campYears.find((year) => year.id === campYearId);
  const line =
    selected != null ? `${selected.name} (${selected.yearLabel})` : campYearId ? campYearId : "—";

  return (
    <div className={className}>
      {showLabel ? <span className="field-label">{label}</span> : null}
      <p style={{ margin: showLabel ? "0.35rem 0 0" : 0, fontWeight: 600, ...valueStyle }}>{line}</p>
    </div>
  );
}
