import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  checkInFamilyPaymentOptionEnabled?: boolean;
};

type CheckInSummary = {
  campersRegistered: number;
  campersCheckedIn: number;
  workersRegistered: number;
  workersCheckedIn: number;
  dormLeadersRegistered: number;
  dormLeadersCheckedIn: number;
  unpaidCampersRemaining: number;
};

type CamperCheckIn = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  medicalNotes: string | null;
  dietaryRestrictions: string | null;
  paymentStatus: string;
  remainingBalanceCents: number;
  balanceState: "unpaid" | "partially_paid" | "paid";
  paymentRequired: boolean;
  checkInStatus: string;
  checkedInAt: string | null;
  dormAssignment: string | null;
  dormLeader: string | null;
  flags: { hasMedicalNotes: boolean; hasDietaryRestrictions: boolean };
};

type WorkerCheckIn = {
  id: string;
  firstName: string;
  lastName: string;
  checkInStatus: string;
  checkedInAt: string | null;
  dormAssignment: string | null;
};

type DormLeaderCheckIn = {
  id: string;
  firstName: string;
  lastName: string;
  checkInStatus: string;
  checkedInAt: string | null;
  dormAssignment: string | null;
};

type PersonTab = "camper" | "worker" | "dorm_leader";

type CamperCheckInPostResponse = {
  camper: CamperCheckIn;
  alreadyCheckedIn: boolean;
  checkInCompletedThisRequest?: boolean;
  dormAutoAssigned?: boolean;
  campers?: Array<{
    camper: CamperCheckIn;
    alreadyCheckedIn: boolean;
    checkInCompletedThisRequest: boolean;
    dormAutoAssigned: boolean;
  }>;
};

type CamperUndoCheckInPostResponse = {
  camper: CamperCheckIn;
  alreadyNotCheckedIn: boolean;
  checkInUndoneThisRequest: boolean;
};

type CamperCheckInDoneModal = {
  familyCheckIn: boolean;
  campers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    middleName: string | null;
    dormLabel: string;
    dormLeader: string | null;
    dormAutoAssigned: boolean;
  }>;
};

export function CheckInPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [personTab, setPersonTab] = useState<PersonTab>("camper");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CamperCheckIn[]>([]);
  const [workerResults, setWorkerResults] = useState<WorkerCheckIn[]>([]);
  const [leaderResults, setLeaderResults] = useState<DormLeaderCheckIn[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedCamper, setSelectedCamper] = useState<CamperCheckIn | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<WorkerCheckIn | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<DormLeaderCheckIn | null>(null);

  const [markPaidCamper, setMarkPaidCamper] = useState(false);
  const [markPaidFamily, setMarkPaidFamily] = useState(false);
  const [busy, setBusy] = useState(false);

  const [camperCheckInModal, setCamperCheckInModal] = useState<CamperCheckInDoneModal | null>(null);

  const selectedCampYear = campYears.find((year) => year.id === campYearId);
  const familyPaymentOptionEnabled =
    selectedCampYear?.checkInFamilyPaymentOptionEnabled === true;
  const selectedCamperHasGuardianEmail = !!selectedCamper?.guardianEmail.trim();

  const loadCampYears = useCallback(async (): Promise<void> => {
    const data = await apiJson<{
      campYears: CampYearOption[];
      activeCampYearId: string | null;
    }>("/api/admin/camp-years");
    setCampYears(data.campYears);
    setCampYearId((previous) =>
      resolveCampYearSelection(data.campYears, data.activeCampYearId, previous),
    );
  }, []);

  const loadSummary = useCallback(async (): Promise<void> => {
    if (!campYearId) {
      setSummary(null);
      return;
    }
    try {
      const data = await apiJson<CheckInSummary>(
        `/api/admin/camp-years/${campYearId}/check-in/summary`,
      );
      setSummary(data);
      setSummaryError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load summary";
      setSummaryError(message);
    }
  }, [campYearId]);

  useEffect(() => {
    void loadCampYears().catch(() => {
      /* surfaced on next interaction */
    });
  }, [loadCampYears]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!camperCheckInModal) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setCamperCheckInModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [camperCheckInModal]);

  useEffect(() => {
    if (!familyPaymentOptionEnabled) {
      setMarkPaidFamily(false);
    }
  }, [familyPaymentOptionEnabled]);

  const runCamperSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    setActionError(null);
    if (!campYearId) {
      setSearchError("Select a camp year.");
      return;
    }
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchError("Enter a name to search.");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson<{ campers: CamperCheckIn[] }>(
        `/api/admin/camp-years/${campYearId}/check-in/search/campers?q=${encodeURIComponent(trimmed)}`,
      );
      setSearchResults(data.campers);
      if (data.campers.length === 0) {
        setSearchError("No campers matched that search.");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const runWorkerSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    if (!campYearId) {
      setSearchError("Select a camp year.");
      return;
    }
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchError("Enter a name to search.");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson<{ workers: WorkerCheckIn[] }>(
        `/api/admin/camp-years/${campYearId}/check-in/search/workers?q=${encodeURIComponent(trimmed)}`,
      );
      setWorkerResults(data.workers);
      if (data.workers.length === 0) {
        setSearchError("No workers matched that search.");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const runLeaderSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    if (!campYearId) {
      setSearchError("Select a camp year.");
      return;
    }
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchError("Enter a name to search.");
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson<{ dormLeaders: DormLeaderCheckIn[] }>(
        `/api/admin/camp-years/${campYearId}/check-in/search/dorm-leaders?q=${encodeURIComponent(trimmed)}`,
      );
      setLeaderResults(data.dormLeaders);
      if (data.dormLeaders.length === 0) {
        setSearchError("No dorm leaders matched that search.");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmCamperCheckIn = async (): Promise<void> => {
    if (!campYearId || !selectedCamper) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const data = await apiJson<CamperCheckInPostResponse>(
        `/api/admin/camp-years/${campYearId}/check-in/campers/${selectedCamper.id}/check-in`,
        {
          method: "POST",
          body: JSON.stringify({
            markPaidCashForCamper: markPaidCamper || undefined,
            markPaidCashForGuardianFamily:
              familyPaymentOptionEnabled && markPaidFamily ? true : undefined,
          }),
        },
      );
      const affectedCampers =
        data.campers ??
        [{
          camper: data.camper,
          alreadyCheckedIn: data.alreadyCheckedIn,
          checkInCompletedThisRequest: data.checkInCompletedThisRequest ?? false,
          dormAutoAssigned: data.dormAutoAssigned ?? false,
        }];
      if (
        (markPaidFamily && affectedCampers.length > 0) ||
        affectedCampers.some((result) => result.checkInCompletedThisRequest)
      ) {
        setCamperCheckInModal({
          familyCheckIn: markPaidFamily,
          campers: affectedCampers.map((result) => ({
            id: result.camper.id,
            firstName: result.camper.firstName,
            lastName: result.camper.lastName,
            middleName: result.camper.middleName,
            dormLabel: result.camper.dormAssignment ?? "Unassigned",
            dormLeader: result.camper.dormLeader,
            dormAutoAssigned: result.dormAutoAssigned,
          })),
        });
      }
      setSelectedCamper(null);
      setMarkPaidCamper(false);
      setMarkPaidFamily(false);
      setSearchResults([]);
      setSearchQuery("");
      await loadSummary();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  const undoCamperCheckIn = async (): Promise<void> => {
    if (!campYearId || !selectedCamper || selectedCamper.checkInStatus !== "checked_in") {
      return;
    }
    const fullName = [selectedCamper.firstName, selectedCamper.middleName, selectedCamper.lastName]
      .filter(Boolean)
      .join(" ");
    const confirmed = globalThis.confirm(
      `Undo check-in for ${fullName}? Their dorm assignment and payment status will not change.`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setActionError(null);
    try {
      const data = await apiJson<CamperUndoCheckInPostResponse>(
        `/api/admin/camp-years/${campYearId}/check-in/campers/${selectedCamper.id}/undo-check-in`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSelectedCamper(data.camper);
      setSearchResults((results) =>
        results.map((camper) => (camper.id === data.camper.id ? data.camper : camper)),
      );
      await loadSummary();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not undo check-in");
    } finally {
      setBusy(false);
    }
  };

  const confirmWorkerCheckIn = async (): Promise<void> => {
    if (!campYearId || !selectedWorker) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/check-in/workers/${selectedWorker.id}/check-in`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSelectedWorker(null);
      setWorkerResults([]);
      setSearchQuery("");
      await loadSummary();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmLeaderCheckIn = async (): Promise<void> => {
    if (!campYearId || !selectedLeader) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await apiJson(
        `/api/admin/camp-years/${campYearId}/check-in/dorm-leaders/${selectedLeader.id}/check-in`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setSelectedLeader(null);
      setLeaderResults([]);
      setSearchQuery("");
      await loadSummary();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="check-in-page">
      <header className="page-header">
        <p className="page-header-eyebrow">Arrival</p>
        <h1>Check-in</h1>
        <p className="page-header-lead">
          Search campers by name. {" "}
          Unassigned campers are placed in a matching camper dorm automatically when they check in (same
          rules as dorm auto-assign). Mark cash payments when collecting fees. Workers and dorm leaders use
          name search.
        </p>
      </header>

      <div className="card check-in-toolbar">
        {superAdmin ? (
          <>
            <label className="field-label" htmlFor="check-in-year">
              Camp year
            </label>
            <select
              id="check-in-year"
              className="field-control"
              value={campYearId}
              onChange={(event) => setCampYearId(event.target.value)}
            >
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
      </div>

      {summaryError ? (
        <p className="form-error" role="alert">
          {summaryError}
        </p>
      ) : null}

      {summary ? (
        <section className="check-in-summary-grid" aria-label="Arrival progress">
          <div className="check-in-stat">
            <span className="check-in-stat-value">
              {summary.campersCheckedIn} / {summary.campersRegistered}
            </span>
            <span className="check-in-stat-label">Campers checked in</span>
          </div>
          <div className="check-in-stat">
            <span className="check-in-stat-value">
              {summary.workersCheckedIn} / {summary.workersRegistered}
            </span>
            <span className="check-in-stat-label">Workers checked in</span>
          </div>
          <div className="check-in-stat">
            <span className="check-in-stat-value">
              {summary.dormLeadersCheckedIn} / {summary.dormLeadersRegistered}
            </span>
            <span className="check-in-stat-label">Dorm leaders checked in</span>
          </div>
          <div className="check-in-stat check-in-stat-warn">
            <span className="check-in-stat-value">{summary.unpaidCampersRemaining}</span>
            <span className="check-in-stat-label">Unpaid campers</span>
          </div>
        </section>
      ) : null}

      <div className="check-in-tabs" role="tablist" aria-label="Who is checking in">
        <button
          type="button"
          role="tab"
          aria-selected={personTab === "camper"}
          className={`check-in-tab${personTab === "camper" ? " active" : ""}`}
          onClick={() => {
            setPersonTab("camper");
            setSelectedWorker(null);
            setSelectedLeader(null);
            setActionError(null);
          }}
        >
          Campers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={personTab === "worker"}
          className={`check-in-tab${personTab === "worker" ? " active" : ""}`}
          onClick={() => {
            setPersonTab("worker");
            setSelectedCamper(null);
            setSelectedLeader(null);
            setActionError(null);
          }}
        >
          Workers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={personTab === "dorm_leader"}
          className={`check-in-tab${personTab === "dorm_leader" ? " active" : ""}`}
          onClick={() => {
            setPersonTab("dorm_leader");
            setSelectedCamper(null);
            setSelectedWorker(null);
            setActionError(null);
          }}
        >
          Dorm leaders
        </button>
      </div>

      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}

      {personTab === "camper" ? (
        <div className="card">
          <form className="stack" onSubmit={(event) => void runCamperSearch(event)}>
              <label className="field-label" htmlFor="camper-search">
                Camper name
              </label>
              <div className="check-in-search-row">
                <input
                  id="camper-search"
                  className="field-control"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="First or last name"
                  autoComplete="off"
                />
                <button type="submit" className="btn primary" disabled={busy}>
                  Search
                </button>
              </div>
              {searchError ? (
                <p className="form-error" role="alert">
                  {searchError}
                </p>
              ) : null}
              <ul className="check-in-result-list">
                {searchResults.map((camper) => (
                  <li key={camper.id}>
                    <button
                      type="button"
                      className="check-in-result-btn"
                      onClick={() => {
                        setSelectedCamper(camper);
                        setMarkPaidCamper(false);
                        setMarkPaidFamily(false);
                      }}
                    >
                      {camper.firstName} {camper.lastName}
                      <span className="muted">
                        {" "}
                        · {camper.paymentStatus.replace(/_/g, " ")} ·{" "}
                        {camper.checkInStatus === "checked_in" ? "Checked in" : "Not checked in"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
          </form>
        </div>
      ) : null}

      {personTab === "worker" ? (
        <div className="card">
          <form className="stack" onSubmit={(event) => void runWorkerSearch(event)}>
            <label className="field-label" htmlFor="worker-search">
              Worker name
            </label>
            <div className="check-in-search-row">
              <input
                id="worker-search"
                className="field-control"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="First or last name"
                autoComplete="off"
              />
              <button type="submit" className="btn primary" disabled={busy}>
                Search
              </button>
            </div>
            {searchError ? (
              <p className="form-error" role="alert">
                {searchError}
              </p>
            ) : null}
            <ul className="check-in-result-list">
              {workerResults.map((worker) => (
                <li key={worker.id}>
                  <button
                    type="button"
                    className="check-in-result-btn"
                    onClick={() => setSelectedWorker(worker)}
                  >
                    {worker.firstName} {worker.lastName}
                    <span className="muted">
                      {" "}
                      · {worker.checkInStatus === "checked_in" ? "Checked in" : "Not checked in"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </form>
        </div>
      ) : null}

      {personTab === "dorm_leader" ? (
        <div className="card">
          <form className="stack" onSubmit={(event) => void runLeaderSearch(event)}>
            <label className="field-label" htmlFor="leader-search">
              Dorm leader name
            </label>
            <div className="check-in-search-row">
              <input
                id="leader-search"
                className="field-control"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="First or last name"
                autoComplete="off"
              />
              <button type="submit" className="btn primary" disabled={busy}>
                Search
              </button>
            </div>
            {searchError ? (
              <p className="form-error" role="alert">
                {searchError}
              </p>
            ) : null}
            <ul className="check-in-result-list">
              {leaderResults.map((leader) => (
                <li key={leader.id}>
                  <button
                    type="button"
                    className="check-in-result-btn"
                    onClick={() => setSelectedLeader(leader)}
                  >
                    {leader.firstName} {leader.lastName}
                    <span className="muted">
                      {" "}
                      · {leader.checkInStatus === "checked_in" ? "Checked in" : "Not checked in"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </form>
        </div>
      ) : null}

      {selectedCamper ? (
        <div className="card check-in-detail">
          <h2 className="check-in-detail-title">
            {[selectedCamper.firstName, selectedCamper.middleName, selectedCamper.lastName]
              .filter(Boolean)
              .join(" ")}
          </h2>
          <dl className="check-in-dl">
            <div>
              <dt>Dorm</dt>
              <dd>{selectedCamper.dormAssignment ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Dorm leader</dt>
              <dd>{selectedCamper.dormLeader ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{selectedCamper.paymentStatus.replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Check-in status</dt>
              <dd>
                {selectedCamper.checkInStatus === "checked_in"
                  ? `Checked in${selectedCamper.checkedInAt ? ` (${new Date(selectedCamper.checkedInAt).toLocaleString()})` : ""}`
                  : "Not checked in yet"}
              </dd>
            </div>
            <div>
              <dt>Guardian</dt>
              <dd>
                {selectedCamper.guardianName || "Not provided"} · {selectedCamper.guardianPhone || "Not provided"}
                <br />
                {selectedCamper.guardianEmail || "No guardian email provided"}
              </dd>
            </div>
          </dl>
          {(selectedCamper.flags.hasMedicalNotes || selectedCamper.flags.hasDietaryRestrictions) && (
            <div className="check-in-alert" role="status">
              {selectedCamper.flags.hasMedicalNotes ? (
                <p>
                  <strong>Medical:</strong> {selectedCamper.medicalNotes || "(flagged)"}
                </p>
              ) : null}
              {selectedCamper.flags.hasDietaryRestrictions ? (
                <p>
                  <strong>Dietary:</strong> {selectedCamper.dietaryRestrictions || "(flagged)"}
                </p>
              ) : null}
            </div>
          )}
          {selectedCamper.paymentRequired ? (
            <fieldset className="check-in-cash-fieldset">
              <legend className="field-label">Cash payment at check-in</legend>
              <label className="check-inline payment-checkbox-button">
                <input
                  type="checkbox"
                  checked={markPaidCamper}
                  onChange={(event) => {
                    setMarkPaidCamper(event.target.checked);
                    if (event.target.checked) {
                      setMarkPaidFamily(false);
                    }
                  }}
                />
                Mark this camper paid (cash)
              </label>
              {familyPaymentOptionEnabled && selectedCamperHasGuardianEmail ? (
                <label className="check-inline payment-checkbox-button">
                  <input
                    type="checkbox"
                    checked={markPaidFamily}
                    onChange={(event) => {
                      setMarkPaidFamily(event.target.checked);
                      if (event.target.checked) {
                        setMarkPaidCamper(false);
                      }
                    }}
                  />
                  Check all campers with this parent/guardian email in and mark them paid (cash)
                </label>
              ) : null}
            </fieldset>
          ) : null}
          <div className="check-in-detail-actions">
            <button type="button" className="btn secondary" onClick={() => setSelectedCamper(null)}>
              Cancel
            </button>
            {selectedCamper.checkInStatus === "checked_in" ? (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void undoCamperCheckIn()}
              >
                Undo check-in
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={
                busy ||
                (selectedCamper.checkInStatus === "checked_in" &&
                  (!selectedCamper.paymentRequired || (!markPaidCamper && !markPaidFamily)))
              }
              onClick={() => void confirmCamperCheckIn()}
            >
              {markPaidFamily
                ? "Check all campers in and record cash payment"
                : selectedCamper.checkInStatus === "checked_in" &&
                    selectedCamper.paymentRequired &&
                    markPaidCamper
                  ? "Record cash payment"
                : selectedCamper.checkInStatus === "checked_in"
                  ? "Already checked in"
                  : "Confirm check-in"}
            </button>
          </div>
        </div>
      ) : null}

      {selectedWorker ? (
        <div className="card check-in-detail">
          <h2 className="check-in-detail-title">
            {selectedWorker.firstName} {selectedWorker.lastName}
          </h2>
          <dl className="check-in-dl">
            <div>
              <dt>Dorm assignment</dt>
              <dd>{selectedWorker.dormAssignment ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedWorker.checkInStatus === "checked_in" ? "Checked in" : "Not checked in"}</dd>
            </div>
          </dl>
          <div className="check-in-detail-actions">
            <button type="button" className="btn secondary" onClick={() => setSelectedWorker(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || selectedWorker.checkInStatus === "checked_in"}
              onClick={() => void confirmWorkerCheckIn()}
            >
              {selectedWorker.checkInStatus === "checked_in" ? "Already checked in" : "Confirm check-in"}
            </button>
          </div>
        </div>
      ) : null}

      {selectedLeader ? (
        <div className="card check-in-detail">
          <h2 className="check-in-detail-title">
            {selectedLeader.firstName} {selectedLeader.lastName}
          </h2>
          <dl className="check-in-dl">
            <div>
              <dt>Dorm assignment</dt>
              <dd>{selectedLeader.dormAssignment ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedLeader.checkInStatus === "checked_in" ? "Checked in" : "Not checked in"}</dd>
            </div>
          </dl>
          <div className="check-in-detail-actions">
            <button type="button" className="btn secondary" onClick={() => setSelectedLeader(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || selectedLeader.checkInStatus === "checked_in"}
              onClick={() => void confirmLeaderCheckIn()}
            >
              {selectedLeader.checkInStatus === "checked_in" ? "Already checked in" : "Confirm check-in"}
            </button>
          </div>
        </div>
      ) : null}

      {camperCheckInModal ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCamperCheckInModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="camper-check-in-done-title"
            className="modal-card check-in-done-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="camper-check-in-done-title" className="check-in-modal-title">
              {camperCheckInModal.familyCheckIn ? "Campers checked in" : "Camper checked in"}
            </h2>
            <p className="check-in-modal-lead">
              {camperCheckInModal.familyCheckIn
                ? "All campers with this parent/guardian email have been checked in and marked paid (cash)."
                : "The camper has been checked in."}
            </p>
            <ul className="check-in-family-dorm-list">
              {camperCheckInModal.campers.map((camper) => {
                const fullName = [camper.firstName, camper.middleName, camper.lastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={camper.id}>
                    <strong>{fullName}</strong>
                    <span>
                      <strong>Dorm assignment:</strong> {camper.dormLabel}
                      {camper.dormAutoAssigned ? (
                        <span className="muted"> (placed automatically)</span>
                      ) : null}
                    </span>
                    <span>
                      <strong>Dorm leader:</strong> {camper.dormLeader ?? "Unassigned"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="muted check-in-modal-hint">
              You can still move {camperCheckInModal.familyCheckIn ? "these campers" : "this camper"} on
              the Dorms page if an assignment needs to change.
            </p>
            <div className="check-in-modal-actions">
              <button type="button" className="btn primary" onClick={() => setCamperCheckInModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
