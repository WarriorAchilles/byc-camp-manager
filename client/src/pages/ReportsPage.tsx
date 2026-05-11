import { useCallback, useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
};

type AgeBracket = {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
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

export function ReportsPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [reportKind, setReportKind] = useState<"dorm" | "checkin">("dorm");
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
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [checkInDormFilter, setCheckInDormFilter] = useState("");
  const [checkInStatusFilter, setCheckInStatusFilter] = useState<"" | "checked_in" | "not_checked_in">("");
  const [checkInGenderFilter, setCheckInGenderFilter] = useState<"" | "male" | "female">("");
  const [checkInBracketFilter, setCheckInBracketFilter] = useState("");

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
    if (!campYearId || reportKind !== "checkin") {
      return;
    }
    setCheckInLoading(true);
    setCheckInError(null);
    try {
      const data = await apiJson<{ campers: CamperListRow[] }>(`/api/admin/camp-years/${campYearId}/campers`);
      setCampers(data.campers);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load campers.";
      setCheckInError(message);
      setCampers([]);
    } finally {
      setCheckInLoading(false);
    }
  }, [campYearId, reportKind]);

  useEffect(() => {
    void loadCheckInData();
  }, [loadCheckInData]);

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
        rows = rows.filter((row) => row.age >= bracket.minAge && row.age <= bracket.maxAge);
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
          </div>
        </div>
      </div>

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
                    {bracket.label} ({bracket.minAge}–{bracket.maxAge})
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
                    ? ` · Age group ${roster.dorm.ageGroupBracket.label} (${roster.dorm.ageGroupBracket.minAge}–${roster.dorm.ageGroupBracket.maxAge})`
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
                    <tr>
                      <th>Camper</th>
                      <th>Age</th>
                      <th>Gender</th>
                      <th>Check-in</th>
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
                    {bracket.label} ({bracket.minAge}–{bracket.maxAge})
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
