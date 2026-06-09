import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";
import { useAuth } from "../auth";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  activeCamperCount?: number;
  camperCapacity: number | null;
};

type CamperRow = {
  id: string;
  firstName: string;
  lastName: string;
  guardianEmail: string;
  paymentStatus: string;
  importSource: string;
  feeDueCents: number | null;
  feePaidCents: number | null;
};

type WorkerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  gender: string;
  importSource: string;
};

type DormLeaderRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  importSource: string;
  assignedCamperDormId: string | null;
  assignedCamperDorm: { id: string; name: string } | null;
};

type DormOption = {
  id: string;
  name: string;
  purpose: string;
};

type CapacityBody = {
  error: "capacity_exceeded";
  message: string;
  currentCamperCount: number;
  capacity: number;
  additionalCampers: number;
};

function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function PeoplePage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";
  const canAddPeople = superAdmin;

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState<string>("");
  const [campers, setCampers] = useState<CamperRow[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [dormLeaders, setDormLeaders] = useState<DormLeaderRow[]>([]);
  const [allDorms, setAllDorms] = useState<DormOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [camperFormError, setCamperFormError] = useState<string | null>(null);
  const [workerFormError, setWorkerFormError] = useState<string | null>(null);
  const [leaderFormError, setLeaderFormError] = useState<string | null>(null);
  const [capacityWarning, setCapacityWarning] = useState<CapacityBody | null>(null);
  const [deleteCamperError, setDeleteCamperError] = useState<string | null>(null);
  const [deletingCamperId, setDeletingCamperId] = useState<string | null>(null);

  const camperDorms = allDorms.filter((dorm) => dorm.purpose === "camper");
  const workerDorms = allDorms.filter((dorm) => dorm.purpose === "worker");

  const [firstName, setFirstName] = useState("Taylor");
  const [lastName, setLastName] = useState("Camper");
  const [dateOfBirth, setDateOfBirth] = useState("2012-05-01");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [guardianName, setGuardianName] = useState("Parent Name");
  const [guardianEmail, setGuardianEmail] = useState("parent@example.com");
  const [guardianPhone, setGuardianPhone] = useState("5551234567");
  const [paymentStatus, setPaymentStatus] = useState<"unpaid" | "paid_cash" | "paid_stripe">(
    "unpaid",
  );
  const [camperDormId, setCamperDormId] = useState<string>("");
  const [overrideAcknowledged, setOverrideAcknowledged] = useState(false);

  const [wEmail, setWEmail] = useState("worker@example.com");
  const [wFirstName, setWFirstName] = useState("Alex");
  const [wLastName, setWLastName] = useState("Volunteer");
  const [wGender, setWGender] = useState<"male" | "female">("female");
  const [wCellPhone, setWCellPhone] = useState("5559876543");
  const [wStreet, setWStreet] = useState("123 Main St");
  const [wCity, setWCity] = useState("Indianapolis");
  const [wState, setWState] = useState("IN");
  const [wPostalCode, setWPostalCode] = useState("46201");
  const [wCountry, setWCountry] = useState("USA");
  const [wDateOfBirth, setWDateOfBirth] = useState("");
  const [workerDormId, setWorkerDormId] = useState<string>("");

  const [dlFirstName, setDlFirstName] = useState("Jordan");
  const [dlLastName, setDlLastName] = useState("Leader");
  const [dlGender, setDlGender] = useState<"male" | "female">("male");
  const [dlEmail, setDlEmail] = useState("leader@example.com");
  const [dlPhone, setDlPhone] = useState("5551112222");
  const [dlRoleLabel, setDlRoleLabel] = useState<string>("");

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

  const loadPeopleData = async (yearId: string): Promise<void> => {
    if (!yearId) {
      setCampers([]);
      setWorkers([]);
      setDormLeaders([]);
      setAllDorms([]);
      return;
    }
    const [campersRes, workersRes, leadersRes, dormsRes] = await Promise.all([
      apiJson<{ campers: CamperRow[] }>(`/api/admin/camp-years/${yearId}/campers`),
      apiJson<{ workers: WorkerRow[] }>(`/api/admin/camp-years/${yearId}/workers`).catch(() => ({
        workers: [],
      })),
      apiJson<{ dormLeaders: DormLeaderRow[] }>(
        `/api/admin/camp-years/${yearId}/dorm-leaders`,
      ).catch(() => ({ dormLeaders: [] })),
      apiJson<{ dorms: DormOption[] }>(`/api/admin/camp-years/${yearId}/dorms`).catch(() => ({
        dorms: [],
      })),
    ]);
    setCampers(campersRes.campers);
    setWorkers(workersRes.workers);
    setDormLeaders(leadersRes.dormLeaders);
    setAllDorms(dormsRes.dorms);
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setListError(null);
      try {
        await loadCampYears();
      } catch {
        setListError("Could not load camp years.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCampYears]);

  useEffect(() => {
    if (!campYearId) {
      return;
    }
    void (async () => {
      try {
        await loadPeopleData(campYearId);
      } catch {
        setListError("Could not load people or dorms for this camp year.");
      }
    })();
  }, [campYearId]);

  const selectedYear = campYears.find((year) => year.id === campYearId);

  const resetCapacityUi = (): void => {
    setCapacityWarning(null);
    setOverrideAcknowledged(false);
  };

  const buildCamperPayload = (confirmCapacityOverride: boolean): Record<string, unknown> => ({
    firstName,
    lastName,
    dateOfBirth,
    gender,
    guardianName,
    guardianEmail,
    guardianPhone,
    paymentStatus,
    ...(camperDormId ? { dormId: camperDormId } : {}),
    ...(confirmCapacityOverride ? { confirmCapacityOverride: true } : {}),
  });

  const handleCreateCamper = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canAddPeople || !campYearId) {
      return;
    }
    setCamperFormError(null);

    const confirmOverride = capacityWarning !== null && overrideAcknowledged;
    if (capacityWarning !== null && !confirmOverride) {
      setCamperFormError("Confirm the capacity override to save this camper.");
      return;
    }

    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/campers`, {
        method: "POST",
        body: JSON.stringify(buildCamperPayload(confirmOverride)),
      });
      resetCapacityUi();
      await loadPeopleData(campYearId);
      await loadCampYears();
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      if (httpError.status === 409 && httpError.body && typeof httpError.body === "object") {
        const body = httpError.body as Partial<CapacityBody>;
        if (body.error === "capacity_exceeded") {
          setCapacityWarning(body as CapacityBody);
          setCamperFormError(null);
          return;
        }
      }
      setCamperFormError(
        httpError instanceof Error ? httpError.message : "Could not create camper.",
      );
    }
  };

  const handleCreateWorker = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canAddPeople || !campYearId) {
      return;
    }
    setWorkerFormError(null);
    const payload: Record<string, unknown> = {
      email: wEmail.trim(),
      firstName: wFirstName.trim(),
      lastName: wLastName.trim(),
      gender: wGender,
      cellPhone: wCellPhone.trim(),
      streetAddress: wStreet.trim(),
      city: wCity.trim(),
      stateOrProvince: wState.trim(),
      postalCode: wPostalCode.trim(),
      country: wCountry.trim(),
      ...(wDateOfBirth.trim() !== "" ? { dateOfBirth: wDateOfBirth.trim() } : {}),
      ...(workerDormId ? { dormId: workerDormId } : {}),
    };
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/workers`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadPeopleData(campYearId);
      setWEmail(`worker-${Date.now()}@example.com`);
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setWorkerFormError(
        httpError instanceof Error ? httpError.message : "Could not create worker.",
      );
    }
  };

  const handleCreateLeader = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canAddPeople || !campYearId) {
      return;
    }
    setLeaderFormError(null);
    const payload: Record<string, unknown> = {
      firstName: dlFirstName.trim(),
      lastName: dlLastName.trim(),
      gender: dlGender,
      email: dlEmail.trim(),
      phone: dlPhone.trim(),
      ...(dlRoleLabel.trim() !== "" ? { roleLabel: dlRoleLabel.trim() } : {}),
    };
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/dorm-leaders`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadPeopleData(campYearId);
      setDlEmail(`leader-${Date.now()}@example.com`);
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setLeaderFormError(
        httpError instanceof Error ? httpError.message : "Could not create dorm leader.",
      );
    }
  };

  const handleDeleteCamper = async (camper: CamperRow): Promise<void> => {
    if (!superAdmin || !campYearId || deletingCamperId !== null) {
      return;
    }
    const camperName = `${camper.firstName} ${camper.lastName}`.trim();
    const confirmed = globalThis.confirm(
      `Delete ${camperName}? This removes the camper from active camp records.`,
    );
    if (!confirmed) {
      return;
    }

    setDeleteCamperError(null);
    setDeletingCamperId(camper.id);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/campers/${camper.id}`, {
        method: "DELETE",
      });
      await Promise.all([loadPeopleData(campYearId), loadCampYears()]);
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setDeleteCamperError(
        httpError instanceof Error ? httpError.message : "Could not delete camper.",
      );
    } finally {
      setDeletingCamperId(null);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>People</h1>
      <p className="muted">
        {canAddPeople ? (
          <>
            Add campers, workers, and dorm leaders for the selected camp year. Campers use camp capacity as a
            soft limit (warn, then optional override). Workers and dorm leaders do not count toward camper
            capacity.
          </>
        ) : (
          <>
            View campers, workers, and dorm leaders for the selected camp year. Only super admins can add
            people here or via Imports.
          </>
        )}
      </p>

      {loading ? <p className="muted">Loading…</p> : null}
      {listError ? <p className="error">{listError}</p> : null}

      <div className="card stack">
        {superAdmin ? (
          <>
            <label htmlFor="peopleCampYear">Camp year</label>
            <select
              id="peopleCampYear"
              value={campYearId}
              onChange={(event) => {
                resetCapacityUi();
                setCampYearId(event.target.value);
              }}
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
        {selectedYear ? (
          <p className="muted">
            Camper headcount {selectedYear.activeCamperCount ?? "—"}
            {selectedYear.camperCapacity != null ? (
              <>
                {" "}
                / capacity {selectedYear.camperCapacity}
              </>
            ) : (
              " — no camper capacity cap"
            )}
          </p>
        ) : null}
      </div>

      {canAddPeople && campYearId ? (
        <>
          <form className="card stack" onSubmit={(event) => void handleCreateCamper(event)}>
            <h2 style={{ marginTop: 0 }}>Add camper</h2>
            {capacityWarning ? (
              <div
                role="alert"
                style={{
                  border: "1px solid var(--danger)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                }}
              >
                <p style={{ marginTop: 0 }}>{capacityWarning.message}</p>
                <label className="row" style={{ alignItems: "flex-start", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={overrideAcknowledged}
                    onChange={(event) => setOverrideAcknowledged(event.target.checked)}
                  />
                  <span>
                    I understand we are above configured capacity and want to add this camper anyway.
                  </span>
                </label>
              </div>
            ) : null}
            {camperFormError ? <p className="error">{camperFormError}</p> : null}
            <div className="row" style={{ gap: "1rem" }}>
              <label style={{ flex: "1 1 140px" }}>
                First name
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </label>
              <label style={{ flex: "1 1 140px" }}>
                Last name
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} required />
              </label>
            </div>
            <label>
              Date of birth
              <input
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
                required
              />
            </label>
            <label>
              Gender
              <select value={gender} onChange={(event) => setGender(event.target.value as "male" | "female")}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>
              Guardian name
              <input value={guardianName} onChange={(event) => setGuardianName(event.target.value)} required />
            </label>
            <label>
              Guardian email
              <input
                type="email"
                value={guardianEmail}
                onChange={(event) => setGuardianEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Guardian phone
              <input value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} required />
            </label>
            <label>
              Payment status
              <select
                value={paymentStatus}
                onChange={(event) =>
                  setPaymentStatus(event.target.value as "unpaid" | "paid_cash" | "paid_stripe")
                }
              >
                <option value="unpaid">Unpaid</option>
                <option value="paid_cash">Paid (cash)</option>
                <option value="paid_stripe">Paid (Stripe)</option>
              </select>
            </label>
            {camperDorms.length > 0 ? (
              <label>
                Camper dorm (optional)
                <select value={camperDormId} onChange={(event) => setCamperDormId(event.target.value)}>
                  <option value="">— Unassigned —</option>
                  {camperDorms.map((dorm) => (
                    <option key={dorm.id} value={dorm.id}>
                      {dorm.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">
                No camper dorms yet. A super admin can add dorms on the{" "}
                <Link to="/admin/dorms">Dorms</Link> page.
              </p>
            )}
            <button type="submit" className="btn">
              {capacityWarning ? "Confirm and add camper" : "Add camper"}
            </button>
          </form>

          <form className="card stack" onSubmit={(event) => void handleCreateWorker(event)}>
            <h2 style={{ marginTop: 0 }}>Add worker</h2>
            <p className="muted" style={{ marginTop: "-0.25rem" }}>
              Volunteers / staff. Email must be unique per camp year.
            </p>
            {workerFormError ? <p className="error">{workerFormError}</p> : null}
            <div className="row" style={{ gap: "1rem" }}>
              <label style={{ flex: "1 1 140px" }}>
                First name
                <input value={wFirstName} onChange={(event) => setWFirstName(event.target.value)} required />
              </label>
              <label style={{ flex: "1 1 140px" }}>
                Last name
                <input value={wLastName} onChange={(event) => setWLastName(event.target.value)} required />
              </label>
            </div>
            <label>
              Email
              <input
                type="email"
                value={wEmail}
                onChange={(event) => setWEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Gender
              <select value={wGender} onChange={(event) => setWGender(event.target.value as "male" | "female")}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>
              Cell phone
              <input value={wCellPhone} onChange={(event) => setWCellPhone(event.target.value)} required />
            </label>
            <label>
              Date of birth (optional)
              <input type="date" value={wDateOfBirth} onChange={(event) => setWDateOfBirth(event.target.value)} />
            </label>
            <label>
              Street address
              <input value={wStreet} onChange={(event) => setWStreet(event.target.value)} required />
            </label>
            <div className="row" style={{ gap: "1rem" }}>
              <label style={{ flex: "1 1 120px" }}>
                City
                <input value={wCity} onChange={(event) => setWCity(event.target.value)} required />
              </label>
              <label style={{ flex: "1 1 80px" }}>
                State / province
                <input value={wState} onChange={(event) => setWState(event.target.value)} required />
              </label>
              <label style={{ flex: "1 1 100px" }}>
                Postal code
                <input value={wPostalCode} onChange={(event) => setWPostalCode(event.target.value)} required />
              </label>
            </div>
            <label>
              Country
              <input value={wCountry} onChange={(event) => setWCountry(event.target.value)} required />
            </label>
            {workerDorms.length > 0 ? (
              <label>
                Worker dorm (optional)
                <select value={workerDormId} onChange={(event) => setWorkerDormId(event.target.value)}>
                  <option value="">— Unassigned —</option>
                  {workerDorms.map((dorm) => (
                    <option key={dorm.id} value={dorm.id}>
                      {dorm.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">
                No worker dorms yet. Add a dorm with purpose “worker” on the{" "}
                <Link to="/admin/dorms">Dorms</Link> page.
              </p>
            )}
            <button type="submit" className="btn">
              Add worker
            </button>
          </form>

          <form className="card stack" onSubmit={(event) => void handleCreateLeader(event)}>
            <h2 style={{ marginTop: 0 }}>Add dorm leader</h2>
            <p className="muted" style={{ marginTop: "-0.25rem" }}>
              Assign leaders to camper dorms on the{" "}
              <Link to="/admin/dorms">Dorms</Link> page (Assignments tab). Worker task preferences apply only to
              workers, not dorm leaders.
            </p>
            {leaderFormError ? <p className="error">{leaderFormError}</p> : null}
            <div className="row" style={{ gap: "1rem" }}>
              <label style={{ flex: "1 1 140px" }}>
                First name
                <input
                  value={dlFirstName}
                  onChange={(event) => setDlFirstName(event.target.value)}
                  required
                />
              </label>
              <label style={{ flex: "1 1 140px" }}>
                Last name
                <input value={dlLastName} onChange={(event) => setDlLastName(event.target.value)} required />
              </label>
            </div>
            <label>
              Gender
              <select value={dlGender} onChange={(event) => setDlGender(event.target.value as "male" | "female")}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <label>
              Email
              <input type="email" value={dlEmail} onChange={(event) => setDlEmail(event.target.value)} required />
            </label>
            <label>
              Phone
              <input value={dlPhone} onChange={(event) => setDlPhone(event.target.value)} required />
            </label>
            <label>
              Role label (optional)
              <input
                value={dlRoleLabel}
                onChange={(event) => setDlRoleLabel(event.target.value)}
                placeholder="e.g. Lead counselor"
              />
            </label>
            <button type="submit" className="btn">
              Add dorm leader
            </button>
          </form>
        </>
      ) : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Campers</h2>
        {deleteCamperError ? <p className="error">{deleteCamperError}</p> : null}
        {campers.length === 0 ? (
          <p className="muted">No campers yet for this year.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Guardian email</th>
                  <th>Fee due</th>
                  <th>Fee paid</th>
                  <th>Payment</th>
                  <th>Source</th>
                  {superAdmin ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {campers.map((camper) => (
                  <tr key={camper.id}>
                    <td>
                      {camper.firstName} {camper.lastName}
                    </td>
                    <td>{camper.guardianEmail}</td>
                    <td>{formatUsdFromCents(camper.feeDueCents)}</td>
                    <td>{formatUsdFromCents(camper.feePaidCents)}</td>
                    <td>{camper.paymentStatus}</td>
                    <td>{camper.importSource}</td>
                    {superAdmin ? (
                      <td>
                        <button
                          type="button"
                          className="btn danger"
                          disabled={deletingCamperId !== null}
                          onClick={() => void handleDeleteCamper(camper)}
                        >
                          {deletingCamperId === camper.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Workers</h2>
        {workers.length === 0 ? (
          <p className="muted">No workers yet for this year.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Gender</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((worker) => (
                  <tr key={worker.id}>
                    <td>
                      {worker.firstName} {worker.lastName}
                    </td>
                    <td>{worker.email}</td>
                    <td>{worker.gender}</td>
                    <td>{worker.importSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2 style={{ marginTop: 0 }}>Dorm leaders</h2>
        {dormLeaders.length > 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Camper dorm assignment: <Link to="/admin/dorms">Dorms → Assignments</Link>.
          </p>
        ) : null}
        {dormLeaders.length === 0 ? (
          <p className="muted">No dorm leaders yet for this year.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Camper dorm</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {dormLeaders.map((leader) => (
                  <tr key={leader.id}>
                    <td>
                      {leader.firstName} {leader.lastName}
                    </td>
                    <td>{leader.email}</td>
                    <td>{leader.phone}</td>
                    <td>{leader.assignedCamperDorm?.name ?? "—"}</td>
                    <td>{leader.importSource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canAddPeople ? (
        <p className="muted">
          Super admins bulk-import campers, workers, and dorm leaders from the{" "}
          <Link to="/admin/imports">Imports</Link> page (CSV preview, column mapping, and capacity override). JSON bulk
          camper import remains available at <code>POST /api/admin/camp-years/:id/campers/import</code> for integrations.
        </p>
      ) : null}
    </div>
  );
}
