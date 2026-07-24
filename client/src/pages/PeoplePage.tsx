import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";
import { useAuth } from "../auth";
import { CampYearReadOnly } from "../components/CampYearReadOnly";
import { PersonEditDialog, type EditablePersonKind } from "../components/PersonEditDialog";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYearOption = {
  id: string;
  name: string;
  yearLabel: string;
  startDate: string;
  activeCamperCount?: number;
  camperCapacity: number | null;
  earlyCamperFeeCents: number | null;
  lateCamperFeeCents: number | null;
  thirdPlusCamperFeeCents: number | null;
};

type CamperRow = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianEmail: string;
  paymentStatus: "unpaid" | "paid_cash" | "paid_stripe";
  checkInStatus: CheckInStatus;
  importSource: string;
  feeDueCents: number | null;
  feePaidCents: number | null;
};

type WorkerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string | null;
  gender: string;
  checkInStatus: CheckInStatus;
  importSource: string;
};

type WorkerRegistrationReview = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string | null;
  gender: string;
  cellPhone: string;
  churchName: string;
  pastorName: string;
  taskPreferenceFirst: string;
  taskPreferenceSecond: string;
  taskPreferenceThird: string;
  submittedAt: string;
  likelyMatches: Array<{
    matchReason: string;
    worker: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      dateOfBirth: string | null;
      cellPhone: string;
    };
  }>;
};

type DormLeaderRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: string;
  roleLabel: string | null;
  checkInStatus: CheckInStatus;
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

type AgeGroupBracket = {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  isActive: boolean;
};

type CheckInStatus = "checked_in" | "not_checked_in";

type PeopleGenderFilter = "" | "male" | "female";

type PeopleCheckInFilter = "" | CheckInStatus;

type PeoplePaymentFilter = "" | "paid" | "unpaid";

function formatUsdFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function dollarsToCents(dollars: string): number {
  return Math.round(Number(dollars) * 100);
}

function formatConfiguredCamperPrice(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "Not configured" : formatUsdFromCents(cents);
}

function paymentStatusLabel(paymentStatus: CamperRow["paymentStatus"]): string {
  if (paymentStatus === "paid_cash") {
    return "Paid (cash)";
  }
  if (paymentStatus === "paid_stripe") {
    return "Paid (Stripe)";
  }
  return "Unpaid";
}

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

function checkInLabel(status: CheckInStatus): string {
  return status === "checked_in" ? "Checked in" : "Not checked in";
}

function genderLabel(value: string): string {
  if (value === "male") {
    return "Male";
  }
  if (value === "female") {
    return "Female";
  }
  return value;
}

function personMatchesNameSearch(
  person: { firstName: string; lastName: string },
  query: string,
): boolean {
  if (!query) {
    return true;
  }
  const firstName = person.firstName.toLowerCase();
  const lastName = person.lastName.toLowerCase();
  const fullName = `${firstName} ${lastName}`;
  const reverseFullName = `${lastName} ${firstName}`;
  return (
    firstName.includes(query) ||
    lastName.includes(query) ||
    fullName.includes(query) ||
    reverseFullName.includes(query)
  );
}

type PeoplePageProps = {
  mode?: "list" | "add";
};

type AddPersonKind = "camper" | "worker" | "leader";

type PeopleListKind = "camper" | "worker" | "dorm_leader";

type PersonToDelete = {
  id: string;
  firstName: string;
  lastName: string;
  kind: "camper" | "worker" | "dorm leader";
  path: "campers" | "workers" | "dorm-leaders";
};

type PersonToEdit = {
  id: string;
  firstName: string;
  lastName: string;
  kind: EditablePersonKind;
};

export function PeoplePage({ mode = "list" }: PeoplePageProps): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const superAdmin = user?.role === "super_admin";
  const canAddPeople = superAdmin;
  const [addPersonKind, setAddPersonKind] = useState<AddPersonKind>("camper");
  const [peopleListKind, setPeopleListKind] = useState<PeopleListKind>("camper");

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState<string>("");
  const [campers, setCampers] = useState<CamperRow[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [workerRegistrationReviews, setWorkerRegistrationReviews] = useState<WorkerRegistrationReview[]>([]);
  const [dormLeaders, setDormLeaders] = useState<DormLeaderRow[]>([]);
  const [allDorms, setAllDorms] = useState<DormOption[]>([]);
  const [ageGroupBrackets, setAgeGroupBrackets] = useState<AgeGroupBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [camperFormError, setCamperFormError] = useState<string | null>(null);
  const [workerFormError, setWorkerFormError] = useState<string | null>(null);
  const [leaderFormError, setLeaderFormError] = useState<string | null>(null);
  const [capacityWarning, setCapacityWarning] = useState<CapacityBody | null>(null);
  const [deletePersonError, setDeletePersonError] = useState<string | null>(null);
  const [deletingPersonId, setDeletingPersonId] = useState<string | null>(null);
  const [personToDelete, setPersonToDelete] = useState<PersonToDelete | null>(null);
  const [paymentStatusError, setPaymentStatusError] = useState<string | null>(null);
  const [updatingPaymentCamperId, setUpdatingPaymentCamperId] = useState<string | null>(null);
  const [personToEdit, setPersonToEdit] = useState<PersonToEdit | null>(null);
  const [workerReviewError, setWorkerReviewError] = useState<string | null>(null);
  const [resolvingWorkerReviewId, setResolvingWorkerReviewId] = useState<string | null>(null);
  const [ageGroupFilter, setAgeGroupFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState<PeopleGenderFilter>("");
  const [checkInFilter, setCheckInFilter] = useState<PeopleCheckInFilter>("");
  const [paymentFilter, setPaymentFilter] = useState<PeoplePaymentFilter>("");
  const [nameSearch, setNameSearch] = useState("");
  const deletePersonConfirmRef = useRef<HTMLButtonElement | null>(null);

  const camperDorms = allDorms.filter((dorm) => dorm.purpose === "camper");

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
  const [amountOwed, setAmountOwed] = useState("");
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
      setWorkerRegistrationReviews([]);
      setDormLeaders([]);
      setAllDorms([]);
      setAgeGroupBrackets([]);
      return;
    }
    const [campersRes, workersRes, leadersRes, dormsRes, ageGroupRes] = await Promise.all([
      apiJson<{ campers: CamperRow[] }>(`/api/admin/camp-years/${yearId}/campers`),
      apiJson<{
        workers: WorkerRow[];
        pendingRegistrationReviews: WorkerRegistrationReview[];
      }>(`/api/admin/camp-years/${yearId}/workers`).catch(() => ({
        workers: [],
        pendingRegistrationReviews: [],
      })),
      apiJson<{ dormLeaders: DormLeaderRow[] }>(
        `/api/admin/camp-years/${yearId}/dorm-leaders`,
      ).catch(() => ({ dormLeaders: [] })),
      apiJson<{ dorms: DormOption[] }>(`/api/admin/camp-years/${yearId}/dorms`).catch(() => ({
        dorms: [],
      })),
      apiJson<{ ageGroupBrackets: AgeGroupBracket[] }>(
        `/api/admin/camp-years/${yearId}/age-group-brackets`,
      ).catch(() => ({ ageGroupBrackets: [] })),
    ]);
    setCampers(campersRes.campers);
    setWorkers(workersRes.workers);
    setWorkerRegistrationReviews(workersRes.pendingRegistrationReviews);
    setDormLeaders(leadersRes.dormLeaders);
    setAllDorms(dormsRes.dorms);
    setAgeGroupBrackets(ageGroupRes.ageGroupBrackets);
  };

  const resolveWorkerRegistrationReview = async (
    reviewId: string,
    decision: "create_new" | "link_existing" | "dismiss",
    workerId?: string,
  ): Promise<void> => {
    if (!campYearId) return;
    setResolvingWorkerReviewId(reviewId);
    setWorkerReviewError(null);
    try {
      await apiJson(
        `/api/admin/camp-years/${campYearId}/workers/registration-reviews/${reviewId}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(workerId ? { workerId } : {}),
          }),
        },
      );
      await loadPeopleData(campYearId);
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setWorkerReviewError(
        httpError instanceof Error
          ? httpError.message
          : "Could not resolve the worker registration review.",
      );
    } finally {
      setResolvingWorkerReviewId(null);
    }
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
  const normalizedNameSearch = nameSearch.trim().toLowerCase();

  const selectedAgeGroup = ageGroupBrackets.find((bracket) => bracket.id === ageGroupFilter);
  const filterByAgeGroup = useCallback(
    (dateOfBirth: string | null): boolean => {
      if (!selectedAgeGroup) {
        return true;
      }
      if (!dateOfBirth || !selectedYear?.startDate) {
        return false;
      }
      const age = ageOnCampStartUtc(dateOfBirth, selectedYear.startDate);
      return age >= selectedAgeGroup.minAge && age <= selectedAgeGroup.maxAge;
    },
    [selectedAgeGroup, selectedYear?.startDate],
  );

  const filteredCampers = useMemo(
    () =>
      campers.filter((camper) => {
        if (!personMatchesNameSearch(camper, normalizedNameSearch)) {
          return false;
        }
        if (genderFilter && camper.gender !== genderFilter) {
          return false;
        }
        if (checkInFilter && camper.checkInStatus !== checkInFilter) {
          return false;
        }
        if (paymentFilter === "paid" && camper.paymentStatus === "unpaid") {
          return false;
        }
        if (paymentFilter === "unpaid" && camper.paymentStatus !== "unpaid") {
          return false;
        }
        return filterByAgeGroup(camper.dateOfBirth);
      }),
    [campers, checkInFilter, filterByAgeGroup, genderFilter, normalizedNameSearch, paymentFilter],
  );

  const filteredWorkers = useMemo(
    () =>
      workers.filter((worker) => {
        if (!personMatchesNameSearch(worker, normalizedNameSearch)) {
          return false;
        }
        if (genderFilter && worker.gender !== genderFilter) {
          return false;
        }
        if (checkInFilter && worker.checkInStatus !== checkInFilter) {
          return false;
        }
        return filterByAgeGroup(worker.dateOfBirth);
      }),
    [checkInFilter, filterByAgeGroup, genderFilter, normalizedNameSearch, workers],
  );

  const filteredDormLeaders = useMemo(
    () =>
      dormLeaders.filter((leader) => {
        if (!personMatchesNameSearch(leader, normalizedNameSearch)) {
          return false;
        }
        if (genderFilter && leader.gender !== genderFilter) {
          return false;
        }
        if (checkInFilter && leader.checkInStatus !== checkInFilter) {
          return false;
        }
        return !selectedAgeGroup || leader.roleLabel === selectedAgeGroup.label;
      }),
    [checkInFilter, dormLeaders, genderFilter, normalizedNameSearch, selectedAgeGroup],
  );

  const filtersActive =
    normalizedNameSearch !== "" ||
    ageGroupFilter !== "" ||
    genderFilter !== "" ||
    checkInFilter !== "" ||
    paymentFilter !== "";

  const resetPeopleFilters = (): void => {
    setNameSearch("");
    setAgeGroupFilter("");
    setGenderFilter("");
    setCheckInFilter("");
    setPaymentFilter("");
  };

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
    feeDueCents: dollarsToCents(amountOwed),
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
      navigate("/admin/people");
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
      navigate("/admin/people");
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
      navigate("/admin/people");
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setLeaderFormError(
        httpError instanceof Error ? httpError.message : "Could not create dorm leader.",
      );
    }
  };

  useEffect(() => {
    if (!personToDelete) {
      return;
    }
    deletePersonConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && deletingPersonId === null) {
        setPersonToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [personToDelete, deletingPersonId]);

  const handleDeletePerson = async (): Promise<void> => {
    const person = personToDelete;
    if (!superAdmin || !campYearId || deletingPersonId !== null) {
      return;
    }
    if (!person) {
      return;
    }

    setDeletePersonError(null);
    setDeletingPersonId(person.id);
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/${person.path}/${person.id}`, {
        method: "DELETE",
      });
      setPersonToDelete(null);
      await Promise.all([loadPeopleData(campYearId), loadCampYears()]);
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setDeletePersonError(
        httpError instanceof Error ? httpError.message : `Could not delete ${person.kind}.`,
      );
    } finally {
      setDeletingPersonId(null);
    }
  };

  const handleToggleCamperPayment = async (camper: CamperRow): Promise<void> => {
    if (!campYearId || updatingPaymentCamperId !== null) {
      return;
    }

    const paymentStatus = camper.paymentStatus === "unpaid" ? "paid_cash" : "unpaid";
    setPaymentStatusError(null);
    setUpdatingPaymentCamperId(camper.id);
    try {
      const updatedCamper = await apiJson<CamperRow>(
        `/api/admin/camp-years/${campYearId}/campers/${camper.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ paymentStatus }),
        },
      );
      setCampers((previous) =>
        previous.map((row) => (row.id === updatedCamper.id ? updatedCamper : row)),
      );
    } catch (caught) {
      const httpError = caught as ApiHttpError;
      setPaymentStatusError(
        httpError instanceof Error ? httpError.message : "Could not update camper payment status.",
      );
    } finally {
      setUpdatingPaymentCamperId(null);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{mode === "add" ? "Add people" : "People"}</h1>
      <p className="muted">
        {mode === "add" ? (
          <>Choose the type of person to add for the selected camp year.</>
        ) : canAddPeople ? (
          <>
            View campers, workers, and dorm leaders for the selected camp year.
          </>
        ) : (
          <>
            View campers, workers, and dorm leaders for the selected camp year. Only super admins can add
            people here or via Imports.
          </>
        )}
      </p>
      {mode === "list" && canAddPeople ? (
        <p>
          <Link className="btn people-add-button" to="/admin/people/add">
            Add people
          </Link>
        </p>
      ) : null}
      {mode === "add" ? (
        <p>
          <Link className="btn secondary people-back-button" to="/admin/people">
            ← Back to people
          </Link>
        </p>
      ) : null}

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

      {mode === "add" && canAddPeople && campYearId ? (
        <>
          <div className="people-add-tabs" role="tablist" aria-label="Person type">
            <button
              id="add-camper-tab"
              type="button"
              role="tab"
              aria-selected={addPersonKind === "camper"}
              aria-controls="add-camper-panel"
              className={`btn secondary${addPersonKind === "camper" ? " active" : ""}`}
              onClick={() => setAddPersonKind("camper")}
            >
              Add camper
            </button>
            <button
              id="add-worker-tab"
              type="button"
              role="tab"
              aria-selected={addPersonKind === "worker"}
              aria-controls="add-worker-panel"
              className={`btn secondary${addPersonKind === "worker" ? " active" : ""}`}
              onClick={() => setAddPersonKind("worker")}
            >
              Add worker
            </button>
            <button
              id="add-leader-tab"
              type="button"
              role="tab"
              aria-selected={addPersonKind === "leader"}
              aria-controls="add-leader-panel"
              className={`btn secondary${addPersonKind === "leader" ? " active" : ""}`}
              onClick={() => setAddPersonKind("leader")}
            >
              Add leader
            </button>
          </div>

          {addPersonKind === "camper" ? (
            <form
              id="add-camper-panel"
              role="tabpanel"
              aria-labelledby="add-camper-tab"
              className="card stack people-add-form"
              onSubmit={(event) => void handleCreateCamper(event)}
            >
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
            <div>
              <div className="row camper-price-label">
                <label htmlFor="camper-amount-owed">Amount owed</label>
                <span className="camper-price-info">
                  <button
                    type="button"
                    className="camper-price-info-trigger"
                    aria-label="Show camper pricing"
                    aria-describedby="camper-price-popup"
                  >
                    i
                  </button>
                  <span id="camper-price-popup" role="tooltip" className="camper-price-popup">
                    <strong>Camper pricing</strong>
                    <span>
                      Early 1st-2nd camper: {formatConfiguredCamperPrice(selectedYear?.earlyCamperFeeCents)}
                    </span>
                    <span>
                      Late 1st-2nd camper: {formatConfiguredCamperPrice(selectedYear?.lateCamperFeeCents)}
                    </span>
                    <span>3rd+ camper: {formatConfiguredCamperPrice(selectedYear?.thirdPlusCamperFeeCents)}</span>
                  </span>
                </span>
              </div>
              <input
                id="camper-amount-owed"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amountOwed}
                onChange={(event) => setAmountOwed(event.target.value)}
                placeholder="0.00"
                required
              />
            </div>
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
          ) : null}

          {addPersonKind === "worker" ? (
            <form
              id="add-worker-panel"
              role="tabpanel"
              aria-labelledby="add-worker-tab"
              className="card stack people-add-form"
              onSubmit={(event) => void handleCreateWorker(event)}
            >
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
            {allDorms.length > 0 ? (
              <label>
                Dorm (optional)
                <select value={workerDormId} onChange={(event) => setWorkerDormId(event.target.value)}>
                  <option value="">— Unassigned —</option>
                  {allDorms.map((dorm) => (
                    <option key={dorm.id} value={dorm.id}>
                      {dorm.name} ({dorm.purpose})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted">
                No dorms yet. Add one on the{" "}
                <Link to="/admin/dorms">Dorms</Link> page.
              </p>
            )}
            <button type="submit" className="btn">
              Add worker
            </button>
            </form>
          ) : null}

          {addPersonKind === "leader" ? (
            <form
              id="add-leader-panel"
              role="tabpanel"
              aria-labelledby="add-leader-tab"
              className="card stack people-add-form"
              onSubmit={(event) => void handleCreateLeader(event)}
            >
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
          ) : null}
        </>
      ) : null}

      {mode === "list" ? (
        <>
          <div className="people-tabs" role="tablist" aria-label="People type">
            <button
              id="campers-tab"
              type="button"
              role="tab"
              aria-selected={peopleListKind === "camper"}
              aria-controls="campers-panel"
              className={`btn secondary${peopleListKind === "camper" ? " active" : ""}`}
              onClick={() => setPeopleListKind("camper")}
            >
              Campers ({filtersActive ? `${filteredCampers.length}/` : ""}{campers.length})
            </button>
            <button
              id="workers-tab"
              type="button"
              role="tab"
              aria-selected={peopleListKind === "worker"}
              aria-controls="workers-panel"
              className={`btn secondary${peopleListKind === "worker" ? " active" : ""}`}
              onClick={() => setPeopleListKind("worker")}
            >
              Workers ({filtersActive ? `${filteredWorkers.length}/` : ""}{workers.length})
            </button>
            <button
              id="dorm-leaders-tab"
              type="button"
              role="tab"
              aria-selected={peopleListKind === "dorm_leader"}
              aria-controls="dorm-leaders-panel"
              className={`btn secondary${peopleListKind === "dorm_leader" ? " active" : ""}`}
              onClick={() => setPeopleListKind("dorm_leader")}
            >
              Dorm leaders ({filtersActive ? `${filteredDormLeaders.length}/` : ""}{dormLeaders.length})
            </button>
          </div>

          <div className="card people-filter-card">
            <div className="people-list-filters">
              <label className="people-name-search">
                Search name
                <input
                  type="text"
                  value={nameSearch}
                  onChange={(event) => setNameSearch(event.target.value)}
                  placeholder="First or last name"
                />
              </label>
              <label>
                Age group
                <select
                  value={ageGroupFilter}
                  onChange={(event) => setAgeGroupFilter(event.target.value)}
                >
                  <option value="">All age groups</option>
                  {ageGroupBrackets.map((bracket) => (
                    <option key={bracket.id} value={bracket.id}>
                      {bracket.label} ({bracket.minAge}-{bracket.maxAge})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Gender
                <select
                  value={genderFilter}
                  onChange={(event) => setGenderFilter(event.target.value as PeopleGenderFilter)}
                >
                  <option value="">All genders</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label>
                Check-in status
                <select
                  value={checkInFilter}
                  onChange={(event) =>
                    setCheckInFilter(event.target.value as PeopleCheckInFilter)
                  }
                >
                  <option value="">All statuses</option>
                  <option value="checked_in">Checked in</option>
                  <option value="not_checked_in">Not checked in</option>
                </select>
              </label>
              <label>
                Payment
                <select
                  value={paymentFilter}
                  onChange={(event) =>
                    setPaymentFilter(event.target.value as PeoplePaymentFilter)
                  }
                >
                  <option value="">All payment statuses</option>
                  <option value="paid">Paid</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </label>
              <button
                type="button"
                className="btn secondary people-filter-reset"
                disabled={!filtersActive}
                onClick={resetPeopleFilters}
              >
                Reset
              </button>
            </div>
            {ageGroupFilter && peopleListKind === "dorm_leader" ? (
              <p className="muted people-filter-note">
                Dorm leader filtering uses the preferred age group recorded on their registration.
              </p>
            ) : null}
            {paymentFilter && peopleListKind !== "camper" ? (
              <p className="muted people-filter-note">
                Payment filters apply to campers only.
              </p>
            ) : null}
          </div>

          {deletePersonError ? <p className="error">{deletePersonError}</p> : null}

          {peopleListKind === "camper" ? (
          <div id="campers-panel" role="tabpanel" aria-labelledby="campers-tab" className="card">
        <h2 style={{ marginTop: 0 }}>Campers</h2>
        {paymentStatusError ? <p className="error">{paymentStatusError}</p> : null}
        {campers.length === 0 ? (
          <p className="muted">No campers yet for this year.</p>
        ) : filteredCampers.length === 0 ? (
          <p className="muted">No campers match the selected filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Check-in</th>
                  <th>Guardian email</th>
                  <th>Fee due</th>
                  <th>Fee paid</th>
                  <th>Payment</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampers.map((camper) => (
                  <tr key={camper.id}>
                    <td>
                      {camper.firstName} {camper.lastName}
                    </td>
                    <td>{genderLabel(camper.gender)}</td>
                    <td>{checkInLabel(camper.checkInStatus)}</td>
                    <td>{camper.guardianEmail}</td>
                    <td>{formatUsdFromCents(camper.feeDueCents)}</td>
                    <td>{formatUsdFromCents(camper.feePaidCents)}</td>
                    <td>{paymentStatusLabel(camper.paymentStatus)}</td>
                    <td>{camper.importSource}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setPersonToEdit({ ...camper, kind: "camper" })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={updatingPaymentCamperId !== null}
                          onClick={() => void handleToggleCamperPayment(camper)}
                        >
                          {updatingPaymentCamperId === camper.id
                            ? "Updating…"
                            : camper.paymentStatus === "unpaid"
                              ? "Mark paid"
                              : "Mark unpaid"}
                        </button>
                        {superAdmin ? (
                          <button
                            type="button"
                            className="btn danger"
                            disabled={deletingPersonId !== null || updatingPaymentCamperId !== null}
                            onClick={() =>
                              setPersonToDelete({
                                ...camper,
                                kind: "camper",
                                path: "campers",
                              })
                            }
                          >
                            {deletingPersonId === camper.id ? "Deleting…" : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </div>
          ) : null}

      {peopleListKind === "worker" ? (
      <div id="workers-panel" role="tabpanel" aria-labelledby="workers-tab" className="card stack">
        <h2 style={{ marginTop: 0 }}>Workers</h2>
        {workerRegistrationReviews.length > 0 ? (
          <section className="worker-review-queue" aria-labelledby="worker-review-heading">
            <div className="worker-review-heading">
              <div>
                <h3 id="worker-review-heading">Registrations needing review</h3>
                <p className="muted">
                  These submissions match an existing worker and are not available to check-in or
                  dorm workflows.
                </p>
              </div>
              <strong>{workerRegistrationReviews.length}</strong>
            </div>
            {workerReviewError ? <p className="error" role="alert">{workerReviewError}</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Submission</th>
                    <th>Likely match</th>
                    <th>Submitted</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {workerRegistrationReviews.map((review) => (
                    <tr key={review.id}>
                      <td>
                        <strong>{review.firstName} {review.lastName}</strong>
                        <span className="worker-review-detail">{review.email}</span>
                        <span className="worker-review-detail">{review.cellPhone}</span>
                      </td>
                      <td>
                        {review.likelyMatches.map((match) => (
                          <span className="worker-review-match" key={match.worker.id}>
                            <strong>{match.worker.firstName} {match.worker.lastName}</strong>
                            <span>{match.worker.email}</span>
                            <span>{match.matchReason.replaceAll("_", " ")}</span>
                          </span>
                        ))}
                      </td>
                      <td>{new Date(review.submittedAt).toLocaleString()}</td>
                      <td>
                        <div className="worker-review-actions">
                          {review.likelyMatches.map((match) => (
                            <button
                              key={match.worker.id}
                              type="button"
                              className="btn secondary"
                              disabled={resolvingWorkerReviewId !== null}
                              onClick={() => void resolveWorkerRegistrationReview(
                                review.id,
                                "link_existing",
                                match.worker.id,
                              )}
                            >
                              Link existing
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={resolvingWorkerReviewId !== null}
                            onClick={() => void resolveWorkerRegistrationReview(review.id, "create_new")}
                          >
                            Create separate worker
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={resolvingWorkerReviewId !== null}
                            onClick={() => void resolveWorkerRegistrationReview(review.id, "dismiss")}
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {workers.length === 0 ? (
          <p className="muted">No workers yet for this year.</p>
        ) : filteredWorkers.length === 0 ? (
          <p className="muted">No workers match the selected filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Gender</th>
                  <th>Check-in</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkers.map((worker) => (
                  <tr key={worker.id}>
                    <td>
                      {worker.firstName} {worker.lastName}
                    </td>
                    <td>{worker.email}</td>
                    <td>{genderLabel(worker.gender)}</td>
                    <td>{checkInLabel(worker.checkInStatus)}</td>
                    <td>{worker.importSource}</td>
                    <td>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setPersonToEdit({ ...worker, kind: "worker" })}
                        >
                          Edit
                        </button>{" "}
                        {superAdmin ? (
                        <button
                          type="button"
                          className="btn danger"
                          disabled={deletingPersonId !== null}
                          onClick={() =>
                            setPersonToDelete({
                              ...worker,
                              kind: "worker",
                              path: "workers",
                            })
                          }
                        >
                          {deletingPersonId === worker.id ? "Deleting…" : "Delete"}
                        </button>
                        ) : null}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : null}

      {peopleListKind === "dorm_leader" ? (
      <div id="dorm-leaders-panel" role="tabpanel" aria-labelledby="dorm-leaders-tab" className="card stack">
        <h2 style={{ marginTop: 0 }}>Dorm leaders</h2>
        {dormLeaders.length > 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Camper dorm assignment: <Link to="/admin/dorms">Dorms → Assignments</Link>.
          </p>
        ) : null}
        {dormLeaders.length === 0 ? (
          <p className="muted">No dorm leaders yet for this year.</p>
        ) : filteredDormLeaders.length === 0 ? (
          <p className="muted">No dorm leaders match the selected filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Preferred age group</th>
                  <th>Gender</th>
                  <th>Check-in</th>
                  <th>Camper dorm</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDormLeaders.map((leader) => (
                  <tr key={leader.id}>
                    <td>
                      {leader.firstName} {leader.lastName}
                    </td>
                    <td>{leader.email}</td>
                    <td>{leader.phone}</td>
                    <td>{leader.roleLabel ?? "—"}</td>
                    <td>{genderLabel(leader.gender)}</td>
                    <td>{checkInLabel(leader.checkInStatus)}</td>
                    <td>{leader.assignedCamperDorm?.name ?? "—"}</td>
                    <td>{leader.importSource}</td>
                    <td>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => setPersonToEdit({ ...leader, kind: "dorm_leader" })}
                        >
                          Edit
                        </button>{" "}
                        {superAdmin ? (
                        <button
                          type="button"
                          className="btn danger"
                          disabled={deletingPersonId !== null}
                          onClick={() =>
                            setPersonToDelete({
                              ...leader,
                              kind: "dorm leader",
                              path: "dorm-leaders",
                            })
                          }
                        >
                          {deletingPersonId === leader.id ? "Deleting…" : "Delete"}
                        </button>
                        ) : null}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : null}

      {canAddPeople ? (
        <p className="muted">
          Super admins bulk-import campers, workers, and dorm leaders from the{" "}
          <Link to="/admin/imports">Imports</Link> page (CSV preview, column mapping, and capacity override). JSON bulk
          camper import remains available at <code>POST /api/admin/camp-years/:id/campers/import</code> for integrations.
        </p>
      ) : null}
        </>
      ) : null}

      {personToDelete ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && deletingPersonId === null) {
              setPersonToDelete(null);
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-person-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-person-title" style={{ marginTop: 0 }}>
              Delete {personToDelete.kind}?
            </h2>
            <p style={{ margin: 0 }}>
              Delete{" "}
              <strong>
                {personToDelete.firstName} {personToDelete.lastName}
              </strong>
              ? This removes the {personToDelete.kind} from active camp records.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={deletingPersonId !== null}
                onClick={() => setPersonToDelete(null)}
              >
                Cancel
              </button>
              <button
                ref={deletePersonConfirmRef}
                type="button"
                className="btn danger"
                disabled={deletingPersonId !== null}
                onClick={() => void handleDeletePerson()}
              >
                {deletingPersonId !== null ? "Deleting…" : `Delete ${personToDelete.kind}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {personToEdit && campYearId ? (
        <PersonEditDialog
          campYearId={campYearId}
          personId={personToEdit.id}
          initialKind={personToEdit.kind}
          personName={`${personToEdit.firstName} ${personToEdit.lastName}`}
          dorms={allDorms}
          canChangeType={superAdmin}
          onClose={() => setPersonToEdit(null)}
          onSaved={async () => {
            await Promise.all([loadPeopleData(campYearId), loadCampYears()]);
          }}
        />
      ) : null}
    </div>
  );
}
