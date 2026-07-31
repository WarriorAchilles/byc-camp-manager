import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import {
  ageFitsGroup,
  formatAgeGroupRange,
  type AgeGroupBracket as AgeBracket,
} from "../ageGroups";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
};

type DormRow = {
  id: string;
  name: string;
  purpose: "camper" | "worker";
  genderDesignation: string;
  bedCapacity: number;
  ageGroupBracketId: string | null;
};

type RosterCamper = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  checkInStatus: string;
  medicalNotes: string | null;
  dietaryRestrictions: string | null;
  guardianName: string;
  guardianPhone: string;
};

type DormRosterResponse = {
  campYear: { id: string; name: string; yearLabel: string; startDate: string };
  dorm: {
    id: string;
    name: string;
    purpose: string;
    genderDesignation: string;
    bedCapacity: number;
    ageGroupBracket: AgeBracket | null;
  };
  occupantCount: number;
  dormLeaders: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    checkInStatus: string;
  }[];
  campers?: RosterCamper[];
  medicalNotesSummaryLines: string[];
};

type CamperListRow = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  checkInStatus: string;
  dormId: string | null;
  churchName: string | null;
  pastorName: string | null;
};

type ChurchFinancialSummary = {
  totals: {
    checkCents: number;
    cashCents: number;
    paymentCount: number;
    allocatedCents: number;
    voidedCents: number;
    outstandingRegistrationFeeCents: number;
  };
  exportRows: Array<Record<string, string | number | null>>;
};

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

type DormLeaderListRow = {
  id: string;
  firstName: string;
  lastName: string;
  checkInStatus: string;
  assignedCamperDormId: string | null;
};

type CamperDormCheckInSummary = {
  dorm: DormRow;
  checkedIn: number;
  assigned: number;
  checkedInDormLeaders: number;
  totalCheckedInForPizza: number;
  ageRange: string;
  ageGroupBracket: AgeBracket | null;
};

type PizzaReportRow = CamperDormCheckInSummary & {
  pizzaFactor: number;
  estimatedSlicesPerPerson: number;
  recommendedPizzas: number;
  cheesePizzas: number;
  pepperoniPizzas: number;
};

/** Matches server `ageOnCampStartUtc` (camp start vs date of birth, UTC calendar). */
function ageOnCampStartUtc(dateOfBirth: string, campStartIso: string): number {
  const dob = new Date(dateOfBirth);
  const campStart = new Date(campStartIso);
  let age = campStart.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = campStart.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && campStart.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function checkInLabel(status: string): string {
  return status === "checked_in" ? "Checked in" : "Not yet arrived";
}

function genderLabel(gender: string): string {
  if (gender === "male") {
    return "Male";
  }
  if (gender === "female") {
    return "Female";
  }
  return gender;
}

function dormGenderLabel(designation: string): string {
  if (designation === "boys") {
    return "Boys";
  }
  if (designation === "girls") {
    return "Girls";
  }
  if (designation === "co_ed") {
    return "Co-ed";
  }
  return designation;
}

function ageRangeLabel(bracket: AgeBracket | undefined): string {
  if (!bracket) {
    return "No age range";
  }
  return formatAgeGroupRange(bracket);
}

function defaultPizzaFactor(dorm: DormRow, bracket: AgeBracket | null): number {
  const isGirls = dorm.genderDesignation === "girls";
  if (!bracket) {
    return isGirls ? 0.2 : 0.25;
  }
  if (isGirls) {
    if (bracket.minAge >= 20) {
      return 0.2;
    }
    if (bracket.minAge >= 17) {
      return 0.22;
    }
    if (bracket.minAge >= 15) {
      return 0.2;
    }
    if (bracket.minAge >= 14) {
      return 0.19;
    }
    if (bracket.minAge >= 12) {
      return 0.17;
    }
    return 0.15;
  }
  if (bracket.minAge >= 16) {
    return 0.25;
  }
  if (bracket.minAge >= 14) {
    return 0.23;
  }
  if (bracket.minAge >= 12) {
    return 0.21;
  }
  return 0.18;
}

function pizzaSplit(genderDesignation: string, recommendedPizzas: number): { cheese: number; pepperoni: number } {
  if (genderDesignation === "girls") {
    const cheese = Math.ceil(recommendedPizzas / 2);
    return { cheese, pepperoni: recommendedPizzas - cheese };
  }
  const cheese = Math.floor(recommendedPizzas / 2);
  return { cheese, pepperoni: recommendedPizzas - cheese };
}

export function ReportsPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [reportKind, setReportKind] = useState<"dorm" | "checkin" | "financial">("dorm");
  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [campYearStartIso, setCampYearStartIso] = useState<string | null>(null);
  const [campYearLabel, setCampYearLabel] = useState("");

  const [dorms, setDorms] = useState<DormRow[]>([]);
  const [brackets, setBrackets] = useState<AgeBracket[]>([]);
  const [dormId, setDormId] = useState("");
  const [filterCheckIn, setFilterCheckIn] = useState<"" | "checked_in" | "not_checked_in">("");
  const [filterGender, setFilterGender] = useState<"" | "male" | "female">("");
  const [filterBracketId, setFilterBracketId] = useState("");

  const [roster, setRoster] = useState<DormRosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [campers, setCampers] = useState<CamperListRow[]>([]);
  const [dormLeaders, setDormLeaders] = useState<DormLeaderListRow[]>([]);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInDormFilter, setCheckInDormFilter] = useState("");
  const [checkInStatusFilter, setCheckInStatusFilter] = useState<"" | "checked_in" | "not_checked_in">("");
  const [checkInGenderFilter, setCheckInGenderFilter] = useState<"" | "male" | "female">("");
  const [checkInBracketFilter, setCheckInBracketFilter] = useState("");
  const [pizzaReportOpen, setPizzaReportOpen] = useState(false);
  const [pizzaFactorsByDormId, setPizzaFactorsByDormId] = useState<Record<string, number>>({});
  const [financialSummary, setFinancialSummary] = useState<ChurchFinancialSummary | null>(null);

  const loadCampYears = useCallback(async () => {
    const data = await apiJson<{
      campYears: CampYearOption[];
      activeCampYearId: string | null;
    }>("/api/admin/camp-years");
    setCampYears(data.campYears);
    setCampYearId((previous) =>
      resolveCampYearSelection(data.campYears, data.activeCampYearId, previous),
    );
  }, []);

  useEffect(() => {
    void loadCampYears().catch(() => {
      setCampYears([]);
    });
  }, [loadCampYears]);

  const loadYearMeta = useCallback(async () => {
    if (!campYearId) {
      setCampYearStartIso(null);
      setCampYearLabel("");
      return;
    }
    try {
      const year = await apiJson<{ name: string; yearLabel: string; startDate: string }>(
        `/api/admin/camp-years/${campYearId}`,
      );
      setCampYearStartIso(year.startDate);
      setCampYearLabel(`${year.name} (${year.yearLabel})`);
    } catch {
      setCampYearStartIso(null);
      setCampYearLabel("");
    }
  }, [campYearId]);

  useEffect(() => {
    void loadYearMeta();
  }, [loadYearMeta]);

  const loadDormsAndBrackets = useCallback(async () => {
    if (!campYearId) {
      setDorms([]);
      setBrackets([]);
      return;
    }
    try {
      const dormsRes = await apiJson<{ dorms: DormRow[] }>(`/api/admin/camp-years/${campYearId}/dorms`);
      setDorms(dormsRes.dorms);
      const bracketRes = await apiJson<{ ageGroupBrackets: AgeBracket[] }>(
        `/api/admin/camp-years/${campYearId}/age-group-brackets`,
      );
      setBrackets(bracketRes.ageGroupBrackets);
    } catch {
      setDorms([]);
      setBrackets([]);
    }
  }, [campYearId]);

  useEffect(() => {
    void loadDormsAndBrackets();
  }, [loadDormsAndBrackets]);

  const camperDorms = useMemo(() => dorms.filter((d) => d.purpose === "camper"), [dorms]);

  const dormNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const dorm of dorms) {
      map.set(dorm.id, dorm.name);
    }
    map.set("", "Unassigned");
    return map;
  }, [dorms]);

  const rosterQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filterCheckIn) {
      params.set("checkInStatus", filterCheckIn);
    }
    if (filterGender) {
      params.set("gender", filterGender);
    }
    if (filterBracketId) {
      params.set("ageGroupBracketId", filterBracketId);
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [filterBracketId, filterCheckIn, filterGender]);

  const loadDormRoster = useCallback(async () => {
    if (!campYearId || !dormId) {
      setRoster(null);
      return;
    }
    setRosterLoading(true);
    setRosterError(null);
    try {
      const data = await apiJson<DormRosterResponse>(
        `/api/admin/camp-years/${campYearId}/dorms/${dormId}/roster${rosterQuery}`,
      );
      setRoster(data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load dorm roster.";
      setRosterError(message);
      setRoster(null);
    } finally {
      setRosterLoading(false);
    }
  }, [campYearId, dormId, rosterQuery]);

  useEffect(() => {
    if (reportKind !== "dorm") {
      return;
    }
    void loadDormRoster();
  }, [loadDormRoster, reportKind]);

  const loadCheckInData = useCallback(async () => {
    if (!campYearId) {
      setCampers([]);
      setDormLeaders([]);
      return;
    }
    setCheckInLoading(true);
    setCheckInError(null);
    try {
      const [camperData, leaderData] = await Promise.all([
        apiJson<{ campers: CamperListRow[] }>(`/api/admin/camp-years/${campYearId}/campers`),
        apiJson<{ dormLeaders: DormLeaderListRow[] }>(`/api/admin/camp-years/${campYearId}/dorm-leaders`),
      ]);
      setCampers(camperData.campers);
      setDormLeaders(leaderData.dormLeaders);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load check-in counts.";
      setCheckInError(message);
      setCampers([]);
      setDormLeaders([]);
    } finally {
      setCheckInLoading(false);
    }
  }, [campYearId]);

  useEffect(() => {
    void loadCheckInData();
  }, [loadCheckInData]);

  useEffect(() => {
    if (!campYearId) {
      setFinancialSummary(null);
      return;
    }
    void apiJson<ChurchFinancialSummary>(
      `/api/admin/churches/financial-summary?campYearId=${encodeURIComponent(campYearId)}`,
    ).then(setFinancialSummary).catch(() => setFinancialSummary(null));
  }, [campYearId]);

  const exportChurchPayments = (): void => {
    if (!financialSummary?.exportRows.length) return;
    const headers = Object.keys(financialSummary.exportRows[0]!);
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
    const csv = [
      headers.map(escape).join(","),
      ...financialSummary.exportRows.map((row) =>
        headers.map((header) => escape(row[header])).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `church-payments-${campYearId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const camperDormCheckInSummaries = useMemo(() => {
    const bracketById = new Map(brackets.map((bracket) => [bracket.id, bracket]));
    const campersByDormId = new Map<string, { checkedIn: number; assigned: number }>();
    const checkedInLeadersByDormId = new Map<string, number>();
    for (const camper of campers) {
      if (!camper.dormId) {
        continue;
      }
      const previous = campersByDormId.get(camper.dormId) ?? { checkedIn: 0, assigned: 0 };
      previous.assigned += 1;
      if (camper.checkInStatus === "checked_in") {
        previous.checkedIn += 1;
      }
      campersByDormId.set(camper.dormId, previous);
    }
    for (const leader of dormLeaders) {
      if (!leader.assignedCamperDormId || leader.checkInStatus !== "checked_in") {
        continue;
      }
      checkedInLeadersByDormId.set(
        leader.assignedCamperDormId,
        (checkedInLeadersByDormId.get(leader.assignedCamperDormId) ?? 0) + 1,
      );
    }
    return camperDorms.map((dorm) => {
      const counts = campersByDormId.get(dorm.id) ?? { checkedIn: 0, assigned: 0 };
      const checkedInDormLeaders = checkedInLeadersByDormId.get(dorm.id) ?? 0;
      const bracket = dorm.ageGroupBracketId ? (bracketById.get(dorm.ageGroupBracketId) ?? null) : null;
      return {
        dorm,
        checkedIn: counts.checkedIn,
        assigned: counts.assigned,
        checkedInDormLeaders,
        totalCheckedInForPizza: counts.checkedIn + checkedInDormLeaders,
        ageRange: ageRangeLabel(bracket ?? undefined),
        ageGroupBracket: bracket,
      };
    });
  }, [brackets, camperDorms, campers, dormLeaders]);

  useEffect(() => {
    setPizzaFactorsByDormId((previous) => {
      const next: Record<string, number> = {};
      for (const summary of camperDormCheckInSummaries) {
        next[summary.dorm.id] =
          previous[summary.dorm.id] ?? defaultPizzaFactor(summary.dorm, summary.ageGroupBracket);
      }
      return next;
    });
  }, [camperDormCheckInSummaries]);

  const pizzaReportRows = useMemo<PizzaReportRow[]>(() => {
    return camperDormCheckInSummaries.map((summary) => {
      const pizzaFactor =
        pizzaFactorsByDormId[summary.dorm.id] ?? defaultPizzaFactor(summary.dorm, summary.ageGroupBracket);
      const recommendedPizzas = Math.ceil(summary.totalCheckedInForPizza * pizzaFactor);
      const split = pizzaSplit(summary.dorm.genderDesignation, recommendedPizzas);
      return {
        ...summary,
        pizzaFactor,
        estimatedSlicesPerPerson: pizzaFactor * 8,
        recommendedPizzas,
        cheesePizzas: split.cheese,
        pepperoniPizzas: split.pepperoni,
      };
    });
  }, [camperDormCheckInSummaries, pizzaFactorsByDormId]);

  const pizzaReportTotals = useMemo(() => {
    return pizzaReportRows.reduce(
      (totals, row) => ({
        checkedInCampers: totals.checkedInCampers + row.checkedIn,
        checkedInDormLeaders: totals.checkedInDormLeaders + row.checkedInDormLeaders,
        recommendedPizzas: totals.recommendedPizzas + row.recommendedPizzas,
        cheesePizzas: totals.cheesePizzas + row.cheesePizzas,
        pepperoniPizzas: totals.pepperoniPizzas + row.pepperoniPizzas,
      }),
      {
        checkedInCampers: 0,
        checkedInDormLeaders: 0,
        recommendedPizzas: 0,
        cheesePizzas: 0,
        pepperoniPizzas: 0,
      },
    );
  }, [pizzaReportRows]);

  const checkInRows = useMemo(() => {
    if (!campYearStartIso) {
      return [];
    }
    let rows = campers.map((camper) => ({
      ...camper,
      age: ageOnCampStartUtc(camper.dateOfBirth, campYearStartIso),
      dormName: camper.dormId ? (dormNameById.get(camper.dormId) ?? "—") : "Unassigned",
    }));
    if (checkInDormFilter) {
      if (checkInDormFilter === "__unassigned__") {
        rows = rows.filter((row) => !row.dormId);
      } else {
        rows = rows.filter((row) => row.dormId === checkInDormFilter);
      }
    }
    if (checkInStatusFilter) {
      rows = rows.filter((row) => row.checkInStatus === checkInStatusFilter);
    }
    if (checkInGenderFilter) {
      rows = rows.filter((row) => row.gender === checkInGenderFilter);
    }
    if (checkInBracketFilter) {
      const bracket = brackets.find((b) => b.id === checkInBracketFilter);
      if (bracket) {
        rows = rows.filter((row) => ageFitsGroup(row.age, bracket));
      }
    }
    rows.sort((a, b) => {
      const dormCompare = a.dormName.localeCompare(b.dormName);
      if (dormCompare !== 0) {
        return dormCompare;
      }
      const last = a.lastName.localeCompare(b.lastName);
      if (last !== 0) {
        return last;
      }
      return a.firstName.localeCompare(b.firstName);
    });
    return rows;
  }, [
    brackets,
    campers,
    checkInBracketFilter,
    checkInDormFilter,
    checkInGenderFilter,
    checkInStatusFilter,
    campYearStartIso,
    dormNameById,
  ]);

  const checkInTotals = useMemo(() => {
    const checkedIn = campers.filter((c) => c.checkInStatus === "checked_in").length;
    const notYet = campers.length - checkedIn;
    return { checkedIn, notYet, total: campers.length };
  }, [campers]);

  function handlePrint(): void {
    window.print();
  }

  return (
    <div className="reports-page">
      <header className="page-header print-hidden">
        <p className="page-header-eyebrow">Operations</p>
        <h1>Reports and exports</h1>
        <p className="page-header-lead">
          Printable rosters for dorm leaders and arrival lists for staff. PDF: use{" "}
          <strong>Print / Save as PDF</strong> (browser print-to-PDF — no server PDF in Phase 1).
        </p>
      </header>

      <div className="card print-hidden">
        <div className="reports-toolbar">
          {superAdmin ? (
            <>
              <label className="field-label" htmlFor="reports-camp-year">
                Camp year
              </label>
              <select
                id="reports-camp-year"
                className="field-control"
                value={campYearId}
                onChange={(event) => {
                  setCampYearId(event.target.value);
                  setDormId("");
                }}
              >
                {campYears.length === 0 ? <option value="">No camp years</option> : null}
                {campYears.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name} ({year.yearLabel})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <CampYearReadOnly campYears={campYears} campYearId={campYearId} />
          )}

          <div className="reports-tab-row" role="tablist" aria-label="Report type">
            <button
              type="button"
              role="tab"
              aria-selected={reportKind === "dorm"}
              className={`btn secondary${reportKind === "dorm" ? " active" : ""}`}
              onClick={() => setReportKind("dorm")}
            >
              Dorm roster
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reportKind === "checkin"}
              className={`btn secondary${reportKind === "checkin" ? " active" : ""}`}
              onClick={() => setReportKind("checkin")}
            >
              Camper check-in (all dorms)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reportKind === "financial"}
              className={`btn secondary${reportKind === "financial" ? " active" : ""}`}
              onClick={() => setReportKind("financial")}
            >
              Financial summary
            </button>
          </div>
        </div>
      </div>

      <section className="card print-hidden dorm-check-in-summary-card" aria-label="Camper dorm check-in summary">
        <h2 className="reports-card-title">Camper dorm check-in summary</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Checked-in camper counts by dorm, with each dorm&apos;s configured age range and gender.
        </p>
        {checkInError ? <p className="error">{checkInError}</p> : null}
        {checkInLoading ? <p className="muted">Loading camper counts...</p> : null}
        {!checkInLoading && camperDormCheckInSummaries.length === 0 ? (
          <p className="muted">No camper dorms configured for this camp year.</p>
        ) : null}
        {camperDormCheckInSummaries.length > 0 ? (
          <div className="report-table-wrap dorm-check-in-summary-table-wrap">
            <table className="report-table dorm-check-in-summary-table">
              <thead>
                <tr>
                  <th>Dorm</th>
                  <th>Gender</th>
                  <th>Age range</th>
                  <th>Assigned campers</th>
                  <th>Checked in</th>
                  <th>Checked-in leaders</th>
                </tr>
              </thead>
              <tbody>
                {camperDormCheckInSummaries.map((summary) => (
                  <tr key={summary.dorm.id}>
                    <td>{summary.dorm.name}</td>
                    <td>{dormGenderLabel(summary.dorm.genderDesignation)}</td>
                    <td>{summary.ageRange}</td>
                    <td>{summary.assigned}</td>
                    <td>{summary.checkedIn}</td>
                    <td>{summary.checkedInDormLeaders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {camperDormCheckInSummaries.length > 0 ? (
          <button
            type="button"
            className="btn secondary dorm-pizza-report-button"
            onClick={() => setPizzaReportOpen(true)}
          >
            Pizza report
          </button>
        ) : null}
      </section>

      {pizzaReportOpen ? (
        <div
          className="modal-backdrop pizza-report-backdrop print-hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPizzaReportOpen(false);
            }
          }}
        >
          <section className="modal-card pizza-report-modal" role="dialog" aria-modal="true" aria-labelledby="pizza-report-title">
            <button
              type="button"
              className="dorm-dialog-close"
              aria-label="Close pizza report"
              onClick={() => setPizzaReportOpen(false)}
            >
              ×
            </button>
            <h2 id="pizza-report-title" className="reports-card-title">
              Dorm pizza report
            </h2>
            <p className="muted pizza-report-intro">
              Pizza counts use checked-in campers plus checked-in dorm leaders. The factor is pizzas per person; large
              pizzas assume 8 slices.
            </p>

            <div className="pizza-report-totals" aria-label="Pizza order totals">
              <div>
                <span className="check-in-stat-value">{pizzaReportTotals.recommendedPizzas}</span>
                <span className="check-in-stat-label">Total pizzas</span>
              </div>
              <div>
                <span className="check-in-stat-value">{pizzaReportTotals.cheesePizzas}</span>
                <span className="check-in-stat-label">Cheese</span>
              </div>
              <div>
                <span className="check-in-stat-value">{pizzaReportTotals.pepperoniPizzas}</span>
                <span className="check-in-stat-label">Pepperoni</span>
              </div>
            </div>

            <div className="report-table-wrap pizza-report-table-wrap">
              <table className="report-table pizza-report-table">
                <thead>
                  <tr>
                    <th>Dorm</th>
                    <th>Checked-in campers</th>
                    <th>Checked-in leaders</th>
                    <th>Total people</th>
                    <th>Factor</th>
                    <th>Slices / person</th>
                    <th>Pizzas</th>
                    <th>Cheese</th>
                    <th>Pepperoni</th>
                  </tr>
                </thead>
                <tbody>
                  {pizzaReportRows.map((row) => (
                    <tr key={row.dorm.id}>
                      <td>
                        <strong>{row.dorm.name}</strong>
                        <span className="pizza-report-dorm-meta">
                          {dormGenderLabel(row.dorm.genderDesignation)} · {row.ageRange}
                        </span>
                      </td>
                      <td>{row.checkedIn}</td>
                      <td>{row.checkedInDormLeaders}</td>
                      <td>{row.totalCheckedInForPizza}</td>
                      <td>
                        <label className="pizza-factor-field">
                          <span className="sr-only">Pizza factor for {row.dorm.name}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.pizzaFactor}
                            onChange={(event) => {
                              const nextFactor = Number(event.target.value);
                              setPizzaFactorsByDormId((previous) => ({
                                ...previous,
                                [row.dorm.id]: Number.isFinite(nextFactor) && nextFactor >= 0 ? nextFactor : 0,
                              }));
                            }}
                          />
                        </label>
                      </td>
                      <td>{row.estimatedSlicesPerPerson.toFixed(2)}</td>
                      <td>{row.recommendedPizzas}</td>
                      <td>{row.cheesePizzas}</td>
                      <td>{row.pepperoniPizzas}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <td>{pizzaReportTotals.checkedInCampers}</td>
                    <td>{pizzaReportTotals.checkedInDormLeaders}</td>
                    <td>{pizzaReportTotals.checkedInCampers + pizzaReportTotals.checkedInDormLeaders}</td>
                    <td />
                    <td />
                    <td>{pizzaReportTotals.recommendedPizzas}</td>
                    <td>{pizzaReportTotals.cheesePizzas}</td>
                    <td>{pizzaReportTotals.pepperoniPizzas}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {reportKind === "financial" ? (
        <section className="card">
          <h2 className="reports-card-title">Church-funded registration fees</h2>
          {!financialSummary ? <p className="muted">Financial summary is unavailable.</p> : (
            <>
              <dl className="check-in-summary-grid">
                <div><dt>Church checks</dt><dd>{money(financialSummary.totals.checkCents)}</dd></div>
                <div><dt>Church cash</dt><dd>{money(financialSummary.totals.cashCents)}</dd></div>
                <div><dt>Payment count</dt><dd>{financialSummary.totals.paymentCount}</dd></div>
                <div><dt>Allocated</dt><dd>{money(financialSummary.totals.allocatedCents)}</dd></div>
                <div><dt>Voided</dt><dd>{money(financialSummary.totals.voidedCents)}</dd></div>
                <div><dt>Outstanding camper fees</dt><dd>{money(financialSummary.totals.outstandingRegistrationFeeCents)}</dd></div>
              </dl>
              <button className="btn secondary" type="button" disabled={financialSummary.exportRows.length === 0} onClick={exportChurchPayments}>
                Export church payments and allocations
              </button>
            </>
          )}
        </section>
      ) : null}

      {reportKind === "dorm" ? (
        <>
          <div className="card print-hidden">
            <h2 className="reports-card-title">Dorm roster report</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Required fields per spec: camper, age, check-in, parent/guardian contact, medical notes (allergies,
              medications, and other notes use the registration <strong>Medical notes</strong> field;{" "}
              <strong>Dietary</strong> is listed separately).
            </p>
            <div className="reports-filters">
              <label className="field-label" htmlFor="reports-dorm">
                Dorm
              </label>
              <select
                id="reports-dorm"
                className="field-control"
                value={dormId}
                onChange={(event) => setDormId(event.target.value)}
                required
              >
                <option value="">Select a camper dorm</option>
                {camperDorms.map((dorm) => (
                  <option key={dorm.id} value={dorm.id}>
                    {dorm.name} · {dormGenderLabel(dorm.genderDesignation)} · {dorm.bedCapacity} beds
                  </option>
                ))}
              </select>

              <label className="field-label" htmlFor="reports-filter-checkin">
                Check-in status
              </label>
              <select
                id="reports-filter-checkin"
                className="field-control"
                value={filterCheckIn}
                onChange={(event) => setFilterCheckIn(event.target.value as typeof filterCheckIn)}
              >
                <option value="">All</option>
                <option value="checked_in">Checked in</option>
                <option value="not_checked_in">Not yet arrived</option>
              </select>

              <label className="field-label" htmlFor="reports-filter-gender">
                Camper gender
              </label>
              <select
                id="reports-filter-gender"
                className="field-control"
                value={filterGender}
                onChange={(event) => setFilterGender(event.target.value as typeof filterGender)}
              >
                <option value="">All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>

              <label className="field-label" htmlFor="reports-filter-bracket">
                Age group (at camp start)
              </label>
              <select
                id="reports-filter-bracket"
                className="field-control"
                value={filterBracketId}
                onChange={(event) => setFilterBracketId(event.target.value)}
              >
                <option value="">All</option>
                {brackets.map((bracket) => (
                  <option key={bracket.id} value={bracket.id}>
                    {formatAgeGroupRange(bracket)}
                  </option>
                ))}
              </select>
            </div>
            <p className="muted" style={{ marginBottom: "0.75rem" }}>
              Filters apply automatically when you change them.
            </p>
            <button type="button" className="btn primary" disabled={!roster} onClick={handlePrint}>
              Print / Save as PDF
            </button>
            {rosterError ? <p className="error">{rosterError}</p> : null}
            {rosterLoading ? <p className="muted">Loading…</p> : null}
          </div>

          {roster && roster.dorm.purpose === "camper" && roster.campers ? (
            <section className="card report-print-document" aria-label="Dorm roster print area">
              <div className="report-print-header">
                <h2 className="report-print-title">Dorm roster — {roster.dorm.name}</h2>
                <p className="report-print-meta">
                  {roster.campYear.name} ({roster.campYear.yearLabel}) · Camp start {roster.campYear.startDate} ·{" "}
                  {dormGenderLabel(roster.dorm.genderDesignation)}
                  {roster.dorm.ageGroupBracket
                    ? ` · Age group ${formatAgeGroupRange(roster.dorm.ageGroupBracket)}`
                    : ""}
                </p>
                <p className="report-print-meta">
                  <strong>Capacity:</strong> {roster.occupantCount} assigned / {roster.dorm.bedCapacity} beds
                </p>
                {roster.dormLeaders.length > 0 ? (
                  <p className="report-print-meta">
                    <strong>Dorm leaders:</strong>{" "}
                    {roster.dormLeaders.map((leader) => `${leader.firstName} ${leader.lastName}`).join(", ")} ·{" "}
                    <span className="report-print-muted">
                      {roster.dormLeaders.map((leader) => leader.phone).join(" · ")}
                    </span>
                  </p>
                ) : (
                  <p className="report-print-meta report-print-muted">No dorm leaders assigned in the system.</p>
                )}
              </div>

              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr className="report-page-title-row">
                      <th colSpan={8}>Dorm roster - {roster.dorm.name}</th>
                    </tr>
                    <tr>
                      <th>Camper</th>
                      <th>Age</th>
                      <th>Gender</th>
                      <th>Check-in</th>
                      <th>Church</th>
                      <th>Parent / guardian</th>
                      <th>Phone</th>
                      <th>Medical notes</th>
                      <th>Dietary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.campers.map((camper) => (
                      <tr key={camper.id}>
                        <td>
                          {camper.firstName} {camper.lastName}
                        </td>
                        <td>{camper.age}</td>
                        <td>{genderLabel(camper.gender)}</td>
                        <td>{checkInLabel(camper.checkInStatus)}</td>
                        <td>{camper.guardianName}</td>
                        <td>{camper.guardianPhone}</td>
                        <td className="report-cell-text">{camper.medicalNotes ?? "—"}</td>
                        <td className="report-cell-text">{camper.dietaryRestrictions ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {roster.medicalNotesSummaryLines.length > 0 ? (
                <div className="report-summary-block">
                  <h3 className="report-summary-heading">Medical / dietary summary (filtered list)</h3>
                  <ul className="report-summary-list">
                    {roster.medicalNotesSummaryLines.map((line, index) => (
                      <li key={`${line}-${index}`}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {roster && roster.dorm.purpose === "worker" ? (
            <p className="card muted">
              Worker dorm rosters are available on the Dorms page. This report focuses on camper dorms per operations
              spec.
            </p>
          ) : null}
        </>
      ) : null}

      {reportKind === "checkin" ? (
        <>
          <div className="card print-hidden">
            <h2 className="reports-card-title">Camper check-in (all dorms)</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Confirmed-style operational list from Phase 1 data (see specs §9 TBD). Totals: {checkInTotals.checkedIn}{" "}
              checked in, {checkInTotals.notYet} not yet arrived, {checkInTotals.total} campers.
            </p>
            <div className="reports-filters">
              <label className="field-label" htmlFor="checkin-dorm-filter">
                Dorm
              </label>
              <select
                id="checkin-dorm-filter"
                className="field-control"
                value={checkInDormFilter}
                onChange={(event) => setCheckInDormFilter(event.target.value)}
              >
                <option value="">All dorms</option>
                <option value="__unassigned__">Unassigned only</option>
                {camperDorms.map((dorm) => (
                  <option key={dorm.id} value={dorm.id}>
                    {dorm.name}
                  </option>
                ))}
              </select>

              <label className="field-label" htmlFor="checkin-status-filter">
                Check-in status
              </label>
              <select
                id="checkin-status-filter"
                className="field-control"
                value={checkInStatusFilter}
                onChange={(event) => setCheckInStatusFilter(event.target.value as typeof checkInStatusFilter)}
              >
                <option value="">All</option>
                <option value="checked_in">Checked in</option>
                <option value="not_checked_in">Not yet arrived</option>
              </select>

              <label className="field-label" htmlFor="checkin-gender-filter">
                Gender
              </label>
              <select
                id="checkin-gender-filter"
                className="field-control"
                value={checkInGenderFilter}
                onChange={(event) => setCheckInGenderFilter(event.target.value as typeof checkInGenderFilter)}
              >
                <option value="">All</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>

              <label className="field-label" htmlFor="checkin-bracket-filter">
                Age group
              </label>
              <select
                id="checkin-bracket-filter"
                className="field-control"
                value={checkInBracketFilter}
                onChange={(event) => setCheckInBracketFilter(event.target.value)}
              >
                <option value="">All</option>
                {brackets.map((bracket) => (
                  <option key={bracket.id} value={bracket.id}>
                    {formatAgeGroupRange(bracket)}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn primary" disabled={checkInRows.length === 0} onClick={handlePrint}>
              Print / Save as PDF
            </button>
            {checkInError ? <p className="error">{checkInError}</p> : null}
            {checkInLoading ? <p className="muted">Loading…</p> : null}
            {!checkInLoading && campers.length > 0 && checkInRows.length === 0 ? (
              <p className="muted">No campers match the current filters.</p>
            ) : null}
            {!checkInLoading && campers.length === 0 && campYearId ? (
              <p className="muted">No campers in this camp year.</p>
            ) : null}
          </div>

          {campYearStartIso && checkInRows.length > 0 ? (
            <section className="card report-print-document" aria-label="Check-in report print area">
              <div className="report-print-header">
                <h2 className="report-print-title">Camper check-in — {campYearLabel}</h2>
                <p className="report-print-meta">Camp start {campYearStartIso.slice(0, 10)} · {checkInRows.length} rows</p>
              </div>
              <div className="report-table-wrap">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Dorm</th>
                      <th>Camper</th>
                      <th>Age</th>
                      <th>Gender</th>
                      <th>Check-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkInRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.dormName}</td>
                        <td>
                          {row.firstName} {row.lastName}
                        </td>
                        <td>{row.age}</td>
                        <td>{genderLabel(row.gender)}</td>
                        <td>{checkInLabel(row.checkInStatus)}</td>
                        <td>{row.churchName ? `${row.churchName} - ${row.pastorName ?? "Pastor not provided"}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {/* <section className="card print-hidden deferred-reports" aria-label="Deferred reports">
        <h2 className="reports-card-title">Additional reports (deferred)</h2>
        <p style={{ marginTop: 0 }}>
          The following are listed in <code>docs/specs.md</code> §9 as <strong>TBD</strong> pending camp admin
          confirmation (decision owner: camp leadership / product). They are not built in this release:
        </p>
        <ul className="deferred-reports-list">
          <li>Registration summary, financial summary, medical summary (nurse view), dietary-only kitchen report</li>
          <li>Emergency contact list, head count summary, merchandise order summary</li>
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>
          Human task on step 06: confirm which of these ship after the first operations release and whether any report
          needs server-rendered PDF instead of print-to-PDF.
        </p>
      </section> */}
    </div>
  );
}
