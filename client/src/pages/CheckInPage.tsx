import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import QRCode from "qrcode";
import { apiJson, type ApiHttpError } from "../api";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  selfCheckInToken?: string | null;
  checkInCamperQrScanEnabled?: boolean;
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
  checkInStatus: string;
  checkedInAt: string | null;
  dormAssignment: string | null;
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
type CamperMode = "scan" | "search";

type CamperCheckInPostResponse = {
  camper: CamperCheckIn;
  alreadyCheckedIn: boolean;
  checkInCompletedThisRequest?: boolean;
  dormAutoAssigned?: boolean;
};

type CamperCheckInDoneModal = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  dormLabel: string;
  dormAutoAssigned: boolean;
};

export function CheckInPage(): React.ReactElement {
  const readerId = useId().replace(/:/g, "");
  const readerElementId = `check-in-qr-${readerId}`;

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [personTab, setPersonTab] = useState<PersonTab>("camper");
  const [camperMode, setCamperMode] = useState<CamperMode>("scan");

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

  const [scannerRunning, setScannerRunning] = useState(false);
  const html5QrRef = useRef<Html5Qrcode | null>(null);

  const [camperCheckInModal, setCamperCheckInModal] = useState<CamperCheckInDoneModal | null>(null);

  const kioskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const kioskPrintImgRef = useRef<HTMLImageElement | null>(null);
  const [kioskBusy, setKioskBusy] = useState(false);
  const [kioskError, setKioskError] = useState<string | null>(null);

  const selectedCampYear = campYears.find((year) => year.id === campYearId);
  const camperQrScanEnabled = selectedCampYear?.checkInCamperQrScanEnabled !== false;
  const kioskToken = selectedCampYear?.selfCheckInToken ?? null;
  const kioskPublicUrl =
    typeof globalThis.window !== "undefined" && kioskToken
      ? `${globalThis.window.location.origin}/self-check-in/${kioskToken}`
      : null;

  const loadCampYears = useCallback(async (): Promise<void> => {
    const data = await apiJson<{ campYears: CampYearOption[] }>("/api/admin/camp-years");
    setCampYears(data.campYears);
    setCampYearId((previous) => {
      if (previous && data.campYears.some((y) => y.id === previous)) {
        return previous;
      }
      return data.campYears.length > 0 ? data.campYears[0].id : "";
    });
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
    setKioskError(null);
  }, [campYearId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    const canvas = kioskCanvasRef.current;
    if (!kioskPublicUrl || !canvas) {
      return;
    }
    void QRCode.toCanvas(canvas, kioskPublicUrl, { width: 240, margin: 2 }).catch(() => {
      /* draw failure — leave canvas blank */
    });
  }, [kioskPublicUrl]);

  useEffect(() => {
    const img = kioskPrintImgRef.current;
    if (!kioskPublicUrl || !img) {
      return;
    }
    void QRCode.toDataURL(kioskPublicUrl, { width: 560, margin: 2 }).then((dataUrl) => {
      img.src = dataUrl;
    });
  }, [kioskPublicUrl]);

  useEffect(() => {
    return () => {
      const instance = html5QrRef.current;
      if (instance) {
        void instance.stop().catch(() => {});
        instance.clear();
        html5QrRef.current = null;
      }
    };
  }, []);

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

  const stopScanner = useCallback(async (): Promise<void> => {
    const instance = html5QrRef.current;
    if (!instance) {
      setScannerRunning(false);
      return;
    }
    try {
      await instance.stop();
    } catch {
      /* already stopped */
    }
    instance.clear();
    html5QrRef.current = null;
    setScannerRunning(false);
  }, []);

  useEffect(() => {
    if (!camperQrScanEnabled && camperMode === "scan") {
      void stopScanner();
      setCamperMode("search");
    }
  }, [camperQrScanEnabled, camperMode, stopScanner]);

  const startScanner = useCallback(async (): Promise<void> => {
    setActionError(null);
    if (!campYearId) {
      setActionError("Select a camp year first.");
      return;
    }
    await stopScanner();
    const instance = new Html5Qrcode(readerElementId);
    html5QrRef.current = instance;
    try {
      await instance.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          try {
            const data = await apiJson<{ camper: CamperCheckIn }>(
              `/api/admin/camp-years/${campYearId}/check-in/lookup/qr?token=${encodeURIComponent(decodedText)}`,
            );
            setSelectedCamper(data.camper);
            setPersonTab("camper");
            setMarkPaidCamper(false);
            setMarkPaidFamily(false);
            await stopScanner();
          } catch (err) {
            const status = (err as ApiHttpError).status;
            setActionError(
              status === 404
                ? "No camper matches that QR code for this camp year."
                : err instanceof Error
                  ? err.message
                  : "Lookup failed",
            );
          }
        },
        () => {},
      );
      setScannerRunning(true);
    } catch (err) {
      html5QrRef.current = null;
      const message = err instanceof Error ? err.message : "Could not start camera";
      setActionError(
        `${message} If you are on desktop, allow the webcam, or use phone search instead.`,
      );
    }
  }, [campYearId, readerElementId, stopScanner]);

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
            markPaidCashForGuardianFamily: markPaidFamily || undefined,
          }),
        },
      );
      if (data.checkInCompletedThisRequest) {
        setCamperCheckInModal({
          firstName: data.camper.firstName,
          lastName: data.camper.lastName,
          middleName: data.camper.middleName,
          dormLabel: data.camper.dormAssignment ?? "Unassigned",
          dormAutoAssigned: data.dormAutoAssigned ?? false,
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

  const issueKioskToken = async (): Promise<void> => {
    if (!campYearId) {
      return;
    }
    setKioskBusy(true);
    setKioskError(null);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/self-check-in/token`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadCampYears();
    } catch (err) {
      setKioskError(err instanceof Error ? err.message : "Could not create kiosk link.");
    } finally {
      setKioskBusy(false);
    }
  };

  const regenerateKioskToken = async (): Promise<void> => {
    if (!campYearId) {
      return;
    }
    const ok = globalThis.confirm(
      "Replace this kiosk link? Printed QR codes and shared links will stop working.",
    );
    if (!ok) {
      return;
    }
    setKioskBusy(true);
    setKioskError(null);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/self-check-in/token/regenerate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadCampYears();
    } catch (err) {
      setKioskError(err instanceof Error ? err.message : "Could not replace kiosk link.");
    } finally {
      setKioskBusy(false);
    }
  };

  const copyKioskUrl = async (): Promise<void> => {
    if (!kioskPublicUrl || !globalThis.navigator?.clipboard?.writeText) {
      setKioskError("Clipboard is not available in this browser.");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(kioskPublicUrl);
    } catch {
      setKioskError("Could not copy to clipboard.");
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
          {camperQrScanEnabled
            ? "Scan camper QR codes or search by name."
            : "Search campers by name."}{" "}
          Unassigned campers are placed in a matching camper dorm automatically when they check in (same
          rules as dorm auto-assign). Mark cash payments when collecting fees. Workers and dorm leaders use
          name search.
        </p>
      </header>

      <div className="card check-in-toolbar">
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
            void stopScanner();
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
            void stopScanner();
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
          {camperQrScanEnabled ? (
            <div className="check-in-subtabs">
              <button
                type="button"
                className={`btn secondary${camperMode === "scan" ? " active" : ""}`}
                onClick={() => setCamperMode("scan")}
              >
                Scan QR
              </button>
              <button
                type="button"
                className={`btn secondary${camperMode === "search" ? " active" : ""}`}
                onClick={() => {
                  void stopScanner();
                  setCamperMode("search");
                }}
              >
                Search name
              </button>
            </div>
          ) : null}

          {camperQrScanEnabled && camperMode === "scan" ? (
            <div className="check-in-scan-block">
              <p className="muted" style={{ marginTop: 0 }}>
                Use a phone or laptop camera. Grant permission when prompted. Point at the camper QR
                code.
              </p>
              <div id={readerElementId} className="check-in-qr-reader" />
              <div className="check-in-scan-actions">
                {!scannerRunning ? (
                  <button type="button" className="btn primary" disabled={busy} onClick={() => void startScanner()}>
                    Start camera
                  </button>
                ) : (
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => void stopScanner()}>
                    Stop camera
                  </button>
                )}
              </div>
            </div>
          ) : (
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
          )}
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

      <section className="card check-in-kiosk-card no-print">
        <h2>Camper self check-in kiosk</h2>
        <p className="muted check-in-kiosk-lead">
          Generate a QR code and post it for arrival day. Scanning opens a page where campers search their own
          name and check in (dorm placement uses the same auto-assign rules as staff check-in). Regenerating
          invalidates old QR prints.
        </p>
        {kioskError ? (
          <p className="form-error" role="alert">
            {kioskError}
          </p>
        ) : null}
        <div className="check-in-kiosk-actions">
          {!kioskToken ? (
            <button
              type="button"
              className="btn primary"
              disabled={!campYearId || kioskBusy}
              onClick={() => void issueKioskToken()}
            >
              Generate kiosk QR
            </button>
          ) : (
            <>
              <button type="button" className="btn secondary" disabled={kioskBusy} onClick={() => void copyKioskUrl()}>
                Copy link
              </button>
              <button type="button" className="btn secondary" disabled={kioskBusy} onClick={() => window.print()}>
                Print QR
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={kioskBusy}
                onClick={() => void regenerateKioskToken()}
              >
                Replace link…
              </button>
            </>
          )}
        </div>
        {kioskToken && kioskPublicUrl ? (
          <div className="check-in-kiosk-body">
            <label className="field-label" htmlFor="check-in-kiosk-url">
              Self check-in URL
            </label>
            <input id="check-in-kiosk-url" className="field-control check-in-kiosk-url-input" readOnly value={kioskPublicUrl} />
            <div className="check-in-kiosk-qr-preview">
              <canvas ref={kioskCanvasRef} className="check-in-kiosk-canvas" width={240} height={240} />
            </div>
          </div>
        ) : null}
      </section>

      {kioskToken ? (
        <div className="kiosk-print-root">
          <div className="kiosk-print-sheet">
            <p className="kiosk-print-eyebrow">Camper check-in</p>
            <h2 className="kiosk-print-title">{selectedCampYear?.name ?? "Camp"}</h2>
            <p className="kiosk-print-meta">{selectedCampYear ? `${selectedCampYear.yearLabel}` : ""}</p>
            <p className="kiosk-print-lead">
              Scan with your phone, search for your name, then tap Check in for your dorm assignment.
            </p>
            <img
              ref={kioskPrintImgRef}
              className="kiosk-print-qr-img"
              alt="QR code linking to the camper self check-in page"
              width={560}
              height={560}
            />
          </div>
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
                {selectedCamper.guardianName} · {selectedCamper.guardianPhone}
                <br />
                {selectedCamper.guardianEmail}
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
          {selectedCamper.paymentStatus === "unpaid" ? (
            <fieldset className="check-in-cash-fieldset">
              <legend className="field-label">Cash payment at check-in</legend>
              <label className="check-inline">
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
              <label className="check-inline">
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
                Mark all campers with this guardian email paid (cash)
              </label>
            </fieldset>
          ) : null}
          <div className="check-in-detail-actions">
            <button type="button" className="btn secondary" onClick={() => setSelectedCamper(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={
                busy ||
                (selectedCamper.checkInStatus === "checked_in" &&
                  (selectedCamper.paymentStatus !== "unpaid" || (!markPaidCamper && !markPaidFamily)))
              }
              onClick={() => void confirmCamperCheckIn()}
            >
              {selectedCamper.checkInStatus === "checked_in" &&
              selectedCamper.paymentStatus === "unpaid" &&
              (markPaidCamper || markPaidFamily)
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
              Camper checked in
            </h2>
            <p className="check-in-modal-lead">
              <strong>
                {[camperCheckInModal.firstName, camperCheckInModal.middleName, camperCheckInModal.lastName]
                  .filter(Boolean)
                  .join(" ")}
              </strong>{" "}
              has been checked in.
            </p>
            <p className="check-in-modal-dorm">
              <strong>Dorm assignment:</strong> {camperCheckInModal.dormLabel}
              {camperCheckInModal.dormAutoAssigned ? (
                <span className="muted"> (placed automatically)</span>
              ) : null}
            </p>
            <p className="muted check-in-modal-hint">
              You can still move this camper on the Dorms page if the assignment needs to change.
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
