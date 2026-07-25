import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { MerchandiseCatalogEditor } from "../components/MerchandiseCatalogEditor";
import { useAuth } from "../auth";
import { resolveCampYearSelectionNullable } from "../campYearSelection";

type CampYearRow = {
  id: string;
  name: string;
  yearLabel: string;
  startDate: string;
  endDate: string;
  camperCapacity: number | null;
  familyRegistrationOpensAt: string | null;
  familyRegistrationClosesAt: string | null;
  familyRegistrationEnabled: boolean;
  familyRegistrationHeaderContent: string;
  familyRegistrationClosedMessage: string;
  workerRegistrationOpensAt: string | null;
  workerRegistrationClosesAt: string | null;
  workerRegistrationEnabled: boolean;
  workerRegistrationHeaderContent: string;
  workerRegistrationClosedMessage: string;
  leaderRegistrationOpensAt: string | null;
  leaderRegistrationClosesAt: string | null;
  leaderRegistrationEnabled: boolean;
  leaderRegistrationHeaderContent: string;
  leaderRegistrationClosedMessage: string;
  feeCutoverAt: string | null;
  earlyCamperFeeCents: number | null;
  lateCamperFeeCents: number | null;
  thirdPlusCamperFeeCents: number | null;
  /** When false, staff Check-in hides the guardian-family cash payment option. */
  checkInFamilyPaymentOptionEnabled?: boolean;
  /** When false, the app does not send guardian confirmation emails after camper check-in. */
  checkInConfirmationEmailsEnabled?: boolean;
  activeCamperCount?: number;
};

type AgeGroupBracket = {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  isActive: boolean;
};

function dateInputFromIso(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function datetimeLocalInputFromIso(isoDate: string | null): string {
  if (!isoDate) {
    return "";
  }
  const date = new Date(isoDate);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function dollarsInputFromCents(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

function nullableDollarsToCents(rawValue: FormDataEntryValue | null): number | null {
  const value = String(rawValue ?? "").trim();
  return value === "" ? null : Math.round(Number(value) * 100);
}

export function CampConfigurationPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [campYears, setCampYears] = useState<CampYearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [createName, setCreateName] = useState("Believer's Youth Camp");
  const [createYearLabel, setCreateYearLabel] = useState("2026");
  const [createStart, setCreateStart] = useState("2026-07-01");
  const [createEnd, setCreateEnd] = useState("2026-07-07");
  const [createCapacity, setCreateCapacity] = useState("");
  const [showCreateCampYearForm, setShowCreateCampYearForm] = useState(false);

  const [ageBrackets, setAgeBrackets] = useState<AgeGroupBracket[]>([]);
  const [ageBracketsLoading, setAgeBracketsLoading] = useState(false);
  const [bracketError, setBracketError] = useState<string | null>(null);
  const [newBracketLabel, setNewBracketLabel] = useState("");
  const [newBracketMin, setNewBracketMin] = useState("");
  const [newBracketMax, setNewBracketMax] = useState("");
  const [newBracketSort, setNewBracketSort] = useState("");
  const [editingBracketId, setEditingBracketId] = useState<string | null>(null);
  const [editBracketLabel, setEditBracketLabel] = useState("");
  const [editBracketMin, setEditBracketMin] = useState("");
  const [editBracketMax, setEditBracketMax] = useState("");
  const [editBracketSort, setEditBracketSort] = useState("");
  const [editBracketActive, setEditBracketActive] = useState(true);
  const [deletingBracketId, setDeletingBracketId] = useState<string | null>(null);
  const [bracketToDelete, setBracketToDelete] = useState<AgeGroupBracket | null>(null);
  const deleteBracketConfirmRef = useRef<HTMLButtonElement | null>(null);
  const [deletingCampYear, setDeletingCampYear] = useState(false);
  const [campYearDeleteDialog, setCampYearDeleteDialog] = useState<{
    campYearId: string;
    confirmationLabel: string;
    step: "warning" | "type_confirmation";
  } | null>(null);
  const [campYearDeleteConfirmation, setCampYearDeleteConfirmation] = useState("");
  const campYearDeleteContinueRef = useRef<HTMLButtonElement | null>(null);
  const campYearDeleteInputRef = useRef<HTMLInputElement | null>(null);

  const [activeCampYearId, setActiveCampYearId] = useState("");
  const [activeCampYearSaving, setActiveCampYearSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const data = await apiJson<{
        campYears: CampYearRow[];
        activeCampYearId: string | null;
      }>("/api/admin/camp-years");
      setCampYears(data.campYears);
      setActiveCampYearId(data.activeCampYearId ?? "");
      setSelectedId((previous) =>
        resolveCampYearSelectionNullable(data.campYears, data.activeCampYearId, previous),
      );
    } catch {
      setError("Could not load camp years.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAgeBrackets = useCallback(async (): Promise<void> => {
    if (!superAdmin || !selectedId) {
      setAgeBrackets([]);
      return;
    }
    setAgeBracketsLoading(true);
    setBracketError(null);
    try {
      const data = await apiJson<{ ageGroupBrackets: AgeGroupBracket[] }>(
        `/api/admin/camp-years/${selectedId}/age-group-brackets`,
      );
      setAgeBrackets(data.ageGroupBrackets);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not load age group brackets.";
      setBracketError(message);
      setAgeBrackets([]);
    } finally {
      setAgeBracketsLoading(false);
    }
  }, [superAdmin, selectedId]);

  useEffect(() => {
    void loadAgeBrackets();
  }, [loadAgeBrackets]);

  const selected = campYears.find((year) => year.id === selectedId) ?? null;

  const nextBracketSortOrder = (): number => {
    if (ageBrackets.length === 0) {
      return 1;
    }
    return Math.max(...ageBrackets.map((bracket) => bracket.sortOrder)) + 1;
  };

  const resetNewBracketForm = (): void => {
    setNewBracketLabel("");
    setNewBracketMin("");
    setNewBracketMax("");
    setNewBracketSort("");
  };

  const beginEditBracket = (bracket: AgeGroupBracket): void => {
    setEditingBracketId(bracket.id);
    setEditBracketLabel(bracket.label);
    setEditBracketMin(String(bracket.minAge));
    setEditBracketMax(String(bracket.maxAge));
    setEditBracketSort(String(bracket.sortOrder));
    setEditBracketActive(bracket.isActive);
  };

  const handleCreateBracket = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !selectedId) {
      return;
    }
    setBracketError(null);
    const minParsed = Number.parseInt(newBracketMin, 10);
    const maxParsed = Number.parseInt(newBracketMax, 10);
    if (Number.isNaN(minParsed) || Number.isNaN(maxParsed)) {
      setBracketError("Min and max age must be whole numbers.");
      return;
    }
    if (minParsed > maxParsed) {
      setBracketError("Min age cannot be greater than max age.");
      return;
    }
    const sortRaw = newBracketSort.trim();
    const sortParsed =
      sortRaw === "" ? nextBracketSortOrder() : Number.parseInt(sortRaw, 10);
    if (Number.isNaN(sortParsed)) {
      setBracketError("Sort order must be a whole number.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${selectedId}/age-group-brackets`, {
        method: "POST",
        body: JSON.stringify({
          label: newBracketLabel.trim(),
          minAge: minParsed,
          maxAge: maxParsed,
          sortOrder: sortParsed,
          isActive: true,
        }),
      });
      resetNewBracketForm();
      await loadAgeBrackets();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not create age group.";
      setBracketError(message);
    }
  };

  const handleSaveBracketEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !selectedId || !editingBracketId) {
      return;
    }
    setBracketError(null);
    const minParsed = Number.parseInt(editBracketMin, 10);
    const maxParsed = Number.parseInt(editBracketMax, 10);
    if (Number.isNaN(minParsed) || Number.isNaN(maxParsed)) {
      setBracketError("Min and max age must be whole numbers.");
      return;
    }
    if (minParsed > maxParsed) {
      setBracketError("Min age cannot be greater than max age.");
      return;
    }
    const sortParsed = Number.parseInt(editBracketSort, 10);
    if (Number.isNaN(sortParsed)) {
      setBracketError("Sort order must be a whole number.");
      return;
    }
    try {
      await apiJson(
        `/api/admin/camp-years/${selectedId}/age-group-brackets/${editingBracketId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: editBracketLabel.trim(),
            minAge: minParsed,
            maxAge: maxParsed,
            sortOrder: sortParsed,
            isActive: editBracketActive,
          }),
        },
      );
      setEditingBracketId(null);
      await loadAgeBrackets();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not update age group.";
      setBracketError(message);
    }
  };

  const patchBracketActive = async (
    bracket: AgeGroupBracket,
    isActive: boolean,
  ): Promise<void> => {
    if (!superAdmin || !selectedId) {
      return;
    }
    setBracketError(null);
    try {
      await apiJson(
        `/api/admin/camp-years/${selectedId}/age-group-brackets/${bracket.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isActive }),
        },
      );
      await loadAgeBrackets();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not update age group.";
      setBracketError(message);
    }
  };

  useEffect(() => {
    if (!bracketToDelete) {
      return;
    }
    deleteBracketConfirmRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && deletingBracketId === null) {
        setBracketToDelete(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bracketToDelete, deletingBracketId]);

  const handleDeleteBracket = async (): Promise<void> => {
    const bracket = bracketToDelete;
    if (!superAdmin || !selectedId || !bracket) {
      return;
    }
    setBracketError(null);
    setDeletingBracketId(bracket.id);
    try {
      await apiJson(`/api/admin/camp-years/${selectedId}/age-group-brackets/${bracket.id}`, {
        method: "DELETE",
      });
      if (editingBracketId === bracket.id) {
        setEditingBracketId(null);
      }
      setBracketToDelete(null);
      await loadAgeBrackets();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not delete age group.";
      setBracketError(message);
    } finally {
      setDeletingBracketId(null);
    }
  };

  const handleCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin) {
      return;
    }
    setError(null);
    const capacityRaw = createCapacity.trim();
    const capacityParsed =
      capacityRaw === "" ? null : Number.parseInt(capacityRaw, 10);
    if (capacityParsed !== null && (Number.isNaN(capacityParsed) || capacityParsed < 1)) {
      setError("Capacity must be a positive integer or blank.");
      return;
    }
    try {
      await apiJson<CampYearRow>("/api/admin/camp-years", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          yearLabel: createYearLabel.trim(),
          startDate: createStart,
          endDate: createEnd,
          camperCapacity: capacityParsed,
        }),
      });
      await load();
      setShowCreateCampYearForm(false);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not create camp year.";
      setError(message);
    }
  };

  const handlePatch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin || !selected) {
      return;
    }
    setError(null);
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const capacityRaw = String(formData.get("camperCapacity") ?? "").trim();
    const capacityParsed =
      capacityRaw === "" ? null : Number.parseInt(capacityRaw, 10);
    if (capacityParsed !== null && (Number.isNaN(capacityParsed) || capacityParsed < 1)) {
      setError("Capacity must be a positive integer or blank.");
      return;
    }
    const earlyCamperFeeCents = nullableDollarsToCents(formData.get("earlyCamperFee"));
    const lateCamperFeeCents = nullableDollarsToCents(formData.get("lateCamperFee"));
    const thirdPlusCamperFeeCents = nullableDollarsToCents(formData.get("thirdPlusCamperFee"));
    const camperFees = [earlyCamperFeeCents, lateCamperFeeCents, thirdPlusCamperFeeCents];
    if (camperFees.some((feeCents) => feeCents !== null && (!Number.isFinite(feeCents) || feeCents < 0))) {
      setError("Camper fees must be non-negative dollar amounts or blank.");
      return;
    }
    const feeCutoverLocal = String(formData.get("feeCutoverAt") ?? "").trim();
    const familyOpensLocal = String(formData.get("familyRegistrationOpensAt") ?? "").trim();
    const familyClosesLocal = String(formData.get("familyRegistrationClosesAt") ?? "").trim();
    const workerOpensLocal = String(formData.get("workerRegistrationOpensAt") ?? "").trim();
    const workerClosesLocal = String(formData.get("workerRegistrationClosesAt") ?? "").trim();
    const leaderOpensLocal = String(formData.get("leaderRegistrationOpensAt") ?? "").trim();
    const leaderClosesLocal = String(formData.get("leaderRegistrationClosesAt") ?? "").trim();
    if ((familyOpensLocal && familyClosesLocal && familyClosesLocal <= familyOpensLocal) ||
        (workerOpensLocal && workerClosesLocal && workerClosesLocal <= workerOpensLocal) ||
        (leaderOpensLocal && leaderClosesLocal && leaderClosesLocal <= leaderOpensLocal)) {
      setError("Each registration close time must be after its open time.");
      return;
    }
    try {
      await apiJson(`/api/admin/camp-years/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(formData.get("name") ?? "").trim(),
          yearLabel: String(formData.get("yearLabel") ?? "").trim(),
          startDate: String(formData.get("startDate") ?? ""),
          endDate: String(formData.get("endDate") ?? ""),
          camperCapacity: capacityParsed,
          familyRegistrationOpensAt: familyOpensLocal ? new Date(familyOpensLocal).toISOString() : null,
          familyRegistrationClosesAt: familyClosesLocal ? new Date(familyClosesLocal).toISOString() : null,
          familyRegistrationEnabled: formData.get("familyRegistrationEnabled") === "on",
          familyRegistrationHeaderContent: String(formData.get("familyRegistrationHeaderContent") ?? "").trim(),
          familyRegistrationClosedMessage: String(formData.get("familyRegistrationClosedMessage") ?? "").trim(),
          workerRegistrationOpensAt: workerOpensLocal ? new Date(workerOpensLocal).toISOString() : null,
          workerRegistrationClosesAt: workerClosesLocal ? new Date(workerClosesLocal).toISOString() : null,
          workerRegistrationEnabled: formData.get("workerRegistrationEnabled") === "on",
          workerRegistrationHeaderContent: String(formData.get("workerRegistrationHeaderContent") ?? "").trim(),
          workerRegistrationClosedMessage: String(formData.get("workerRegistrationClosedMessage") ?? "").trim(),
          leaderRegistrationOpensAt: leaderOpensLocal ? new Date(leaderOpensLocal).toISOString() : null,
          leaderRegistrationClosesAt: leaderClosesLocal ? new Date(leaderClosesLocal).toISOString() : null,
          leaderRegistrationEnabled: formData.get("leaderRegistrationEnabled") === "on",
          leaderRegistrationHeaderContent: String(formData.get("leaderRegistrationHeaderContent") ?? "").trim(),
          leaderRegistrationClosedMessage: String(formData.get("leaderRegistrationClosedMessage") ?? "").trim(),
          feeCutoverAt: feeCutoverLocal ? new Date(feeCutoverLocal).toISOString() : null,
          earlyCamperFeeCents,
          lateCamperFeeCents,
          thirdPlusCamperFeeCents,
          checkInFamilyPaymentOptionEnabled:
            formData.get("checkInFamilyPaymentOptionEnabled") === "on",
          checkInConfirmationEmailsEnabled:
            formData.get("checkInConfirmationEmailsEnabled") === "on",
        }),
      });
      await load();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save camp configuration.";
      setError(message);
    }
  };

  const handleSaveActiveCampYear = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!superAdmin) {
      return;
    }
    setError(null);
    setActiveCampYearSaving(true);
    try {
      await apiJson<{ activeCampYearId: string | null }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          activeCampYearId: activeCampYearId === "" ? null : activeCampYearId,
        }),
      });
      await load();
    } catch (caught) {
      const message =
          caught instanceof Error ? caught.message : "Could not save active camp year.";
      setError(message);
    } finally {
      setActiveCampYearSaving(false);
    }
  };

  const openCampYearDeleteDialog = (): void => {
    if (!superAdmin || !selected) {
      return;
    }
    setCampYearDeleteConfirmation("");
    setCampYearDeleteDialog({
      campYearId: selected.id,
      confirmationLabel: `${selected.name} (${selected.yearLabel})`,
      step: "warning",
    });
  };

  const closeCampYearDeleteDialog = useCallback((): void => {
    if (deletingCampYear) {
      return;
    }
    setCampYearDeleteDialog(null);
    setCampYearDeleteConfirmation("");
  }, [deletingCampYear]);

  useEffect(() => {
    if (!campYearDeleteDialog) {
      return;
    }
    if (campYearDeleteDialog.step === "warning") {
      campYearDeleteContinueRef.current?.focus();
    } else {
      campYearDeleteInputRef.current?.focus();
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !deletingCampYear) {
        closeCampYearDeleteDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [campYearDeleteDialog, closeCampYearDeleteDialog, deletingCampYear]);

  const handleDeleteCampYear = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (
      !superAdmin ||
      !campYearDeleteDialog ||
      campYearDeleteDialog.step !== "type_confirmation" ||
      campYearDeleteConfirmation !== campYearDeleteDialog.confirmationLabel
    ) {
      return;
    }
    setError(null);
    setDeletingCampYear(true);
    try {
      await apiJson(`/api/admin/camp-years/${campYearDeleteDialog.campYearId}`, {
        method: "DELETE",
        body: JSON.stringify({
          confirmationLabel: campYearDeleteDialog.confirmationLabel,
        }),
      });
      setCampYearDeleteDialog(null);
      setCampYearDeleteConfirmation("");
      setEditingBracketId(null);
      setAgeBrackets([]);
      await load();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not delete camp year.";
      setError(message);
    } finally {
      setDeletingCampYear(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Camp configuration</h1>
      <p className="muted">
        Super admins edit camp-wide settings and age groups for each year. Camp admins can review counts
        but cannot change fee placeholders, capacity, or age brackets here.
      </p>

      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {superAdmin ? (
        <form className="card stack" onSubmit={(event) => void handleSaveActiveCampYear(event)}>
          <h2 style={{ marginTop: 0 }}>Active camp year</h2>
          <p className="muted" style={{ margin: 0 }}>
            This year powers public registration and is pre-selected on admin operational pages. Public
            registration stays closed when no active year is selected.
          </p>
          <label htmlFor="activeCampYear">Active for admin and registration</label>
          <select
            id="activeCampYear"
            value={activeCampYearId}
            onChange={(event) => setActiveCampYearId(event.target.value)}
          >
            <option value="">No active camp year</option>
            {campYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name} ({year.yearLabel})
              </option>
            ))}
          </select>
          <button type="submit" className="btn" disabled={activeCampYearSaving}>
            {activeCampYearSaving ? "Saving…" : "Save active year"}
          </button>
        </form>
      ) : null}

      <div className="card stack">
        <label htmlFor="campYearPick">Camp year to configure</label>
        <select
          id="campYearPick"
          value={selectedId ?? ""}
          onChange={(event) => setSelectedId(event.target.value || null)}
        >
          {campYears.map((year) => (
            <option key={year.id} value={year.id}>
              {year.name} ({year.yearLabel})
            </option>
          ))}
        </select>
        {selected ? (
          <p className="muted">
            Active campers recorded (non-archived):{" "}
            <strong>{selected.activeCamperCount ?? "—"}</strong>
            {selected.camperCapacity != null ? (
              <>
                {" "}
                / configured capacity <strong>{selected.camperCapacity}</strong>
              </>
            ) : (
              <> — no capacity cap configured</>
            )}
          </p>
        ) : (
          <p className="muted">Create a camp year below to begin.</p>
        )}
      </div>

      {superAdmin && !showCreateCampYearForm ? (
        <div className="card">
          <button type="button" className="btn" onClick={() => setShowCreateCampYearForm(true)}>
            Add new camp year
          </button>
        </div>
      ) : null}

      {superAdmin && showCreateCampYearForm ? (
        <form className="card stack" onSubmit={handleCreate}>
          <h2 style={{ marginTop: 0 }}>New camp year</h2>
          <label>
            Display name
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              required
            />
          </label>
          <label>
            Year label
            <input
              value={createYearLabel}
              onChange={(event) => setCreateYearLabel(event.target.value)}
              required
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={createStart}
              onChange={(event) => setCreateStart(event.target.value)}
              required
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={createEnd}
              onChange={(event) => setCreateEnd(event.target.value)}
              required
            />
          </label>
          <label>
            Camper capacity (optional max headcount)
            <input
              inputMode="numeric"
              placeholder="e.g. 120"
              value={createCapacity}
              onChange={(event) => setCreateCapacity(event.target.value)}
            />
          </label>
          <div className="row">
            <button type="submit" className="btn">
              Create camp year
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setShowCreateCampYearForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {superAdmin && selectedId ? (
        <div className="card stack">
          <h2 style={{ marginTop: 0 }}>Age groups ({selected?.yearLabel ?? "camp year"})</h2>
          <p className="muted" style={{ margin: 0 }}>
            Used for camper dorm auto-assignment and labels. Ages are measured at camp start (same rule
            as dorm assignment).
          </p>
          {bracketError ? <p className="error">{bracketError}</p> : null}
          {ageBracketsLoading ? <p className="muted">Loading age groups…</p> : null}

          <form className="stack" onSubmit={handleCreateBracket}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Add age group</h3>
            <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="stack" style={{ flex: "1 1 140px" }}>
                Label
                <input
                  value={newBracketLabel}
                  onChange={(event) => setNewBracketLabel(event.target.value)}
                  placeholder="e.g. Juniors"
                  required
                />
              </label>
              <label className="stack" style={{ flex: "0 0 88px" }}>
                Min age
                <input
                  inputMode="numeric"
                  value={newBracketMin}
                  onChange={(event) => setNewBracketMin(event.target.value)}
                  required
                />
              </label>
              <label className="stack" style={{ flex: "0 0 88px" }}>
                Max age
                <input
                  inputMode="numeric"
                  value={newBracketMax}
                  onChange={(event) => setNewBracketMax(event.target.value)}
                  required
                />
              </label>
              <label className="stack" style={{ flex: "0 0 100px" }}>
                Sort order
                <input
                  inputMode="numeric"
                  value={newBracketSort}
                  onChange={(event) => setNewBracketSort(event.target.value)}
                  placeholder={`default ${nextBracketSortOrder()}`}
                />
              </label>
              <button type="submit" className="btn">
                Add
              </button>
            </div>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Ages</th>
                  <th>Sort</th>
                  <th>Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ageBrackets.length === 0 && !ageBracketsLoading ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No age groups yet. Add one above for dorm auto-assignment.
                    </td>
                  </tr>
                ) : null}
                {ageBrackets.map((bracket) => (
                  <tr key={bracket.id}>
                    <td>{bracket.label}</td>
                    <td>
                      {bracket.minAge}–{bracket.maxAge}
                    </td>
                    <td>{bracket.sortOrder}</td>
                    <td>
                      <label className="row" style={{ gap: "0.35rem" }}>
                        <input
                          type="checkbox"
                          checked={bracket.isActive}
                          onChange={(event) =>
                            void patchBracketActive(bracket, event.target.checked)
                          }
                          aria-label={`Active: ${bracket.label}`}
                        />
                        <span className="muted" style={{ fontSize: "0.8rem" }}>
                          {bracket.isActive ? "yes" : "no"}
                        </span>
                      </label>
                    </td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => beginEditBracket(bracket)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          disabled={deletingBracketId === bracket.id}
                          onClick={() => setBracketToDelete(bracket)}
                        >
                          {deletingBracketId === bracket.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {editingBracketId ? (
            <form className="stack" onSubmit={handleSaveBracketEdit}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Edit age group</h3>
              <label className="stack">
                Label
                <input
                  value={editBracketLabel}
                  onChange={(event) => setEditBracketLabel(event.target.value)}
                  required
                />
              </label>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <label className="stack" style={{ flex: "0 0 120px" }}>
                  Min age
                  <input
                    inputMode="numeric"
                    value={editBracketMin}
                    onChange={(event) => setEditBracketMin(event.target.value)}
                    required
                  />
                </label>
                <label className="stack" style={{ flex: "0 0 120px" }}>
                  Max age
                  <input
                    inputMode="numeric"
                    value={editBracketMax}
                    onChange={(event) => setEditBracketMax(event.target.value)}
                    required
                  />
                </label>
                <label className="stack" style={{ flex: "0 0 120px" }}>
                  Sort order
                  <input
                    inputMode="numeric"
                    value={editBracketSort}
                    onChange={(event) => setEditBracketSort(event.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="row" style={{ gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={editBracketActive}
                  onChange={(event) => setEditBracketActive(event.target.checked)}
                />
                <span>Active</span>
              </label>
              <div className="row">
                <button type="submit" className="btn">
                  Save age group
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setEditingBracketId(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {superAdmin && selected ? (
        <form key={selected.id} className="card stack" onSubmit={handlePatch}>
          <h2 style={{ marginTop: 0 }}>Edit {selected.yearLabel}</h2>
          <label>
            Display name
            <input name="name" defaultValue={selected.name} required />
          </label>
          <label>
            Year label
            <input name="yearLabel" defaultValue={selected.yearLabel} required />
          </label>
          <label>
            Start date
            <input
              name="startDate"
              type="date"
              defaultValue={dateInputFromIso(selected.startDate)}
              required
            />
          </label>
          <label>
            End date
            <input
              name="endDate"
              type="date"
              defaultValue={dateInputFromIso(selected.endDate)}
              required
            />
          </label>
          <label>
            Camper capacity (optional — admin entry / CSV can warn past this cap)
            <input
              name="camperCapacity"
              inputMode="numeric"
              placeholder="blank = no cap"
              defaultValue={selected.camperCapacity ?? ""}
            />
          </label>
          <fieldset className="configuration-fieldset stack">
            <legend>Camper registration availability</legend>
            <label className="row configuration-toggle">
              <input type="checkbox" name="familyRegistrationEnabled" defaultChecked={selected.familyRegistrationEnabled} />
              <span>Manually enable camper registration</span>
            </label>
            <div className="configuration-time-grid">
              <label>
                Opens at
                <input name="familyRegistrationOpensAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.familyRegistrationOpensAt)} />
              </label>
              <label>
                Closes at (optional)
                <input name="familyRegistrationClosesAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.familyRegistrationClosesAt)} />
              </label>
            </div>
            <label>
              Public header content
              <textarea name="familyRegistrationHeaderContent" rows={6} maxLength={10_000} defaultValue={selected.familyRegistrationHeaderContent} required />
            </label>
            <label>
              Closed/countdown message
              <textarea name="familyRegistrationClosedMessage" rows={3} maxLength={2_000} defaultValue={selected.familyRegistrationClosedMessage} required />
            </label>
          </fieldset>

          <fieldset className="configuration-fieldset stack">
            <legend>Worker registration availability</legend>
            <label className="row configuration-toggle">
              <input type="checkbox" name="workerRegistrationEnabled" defaultChecked={selected.workerRegistrationEnabled} />
              <span>Manually enable worker registration</span>
            </label>
            <div className="configuration-time-grid">
              <label>
                Opens at
                <input name="workerRegistrationOpensAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.workerRegistrationOpensAt)} />
              </label>
              <label>
                Closes at (optional)
                <input name="workerRegistrationClosesAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.workerRegistrationClosesAt)} />
              </label>
            </div>
            <label>
              Public header content
              <textarea name="workerRegistrationHeaderContent" rows={6} maxLength={10_000} defaultValue={selected.workerRegistrationHeaderContent} required />
            </label>
            <label>
              Closed/countdown message
              <textarea name="workerRegistrationClosedMessage" rows={3} maxLength={2_000} defaultValue={selected.workerRegistrationClosedMessage} required />
            </label>
          </fieldset>

          <fieldset className="configuration-fieldset stack">
            <legend>Leader registration availability</legend>
            <label className="row configuration-toggle">
              <input type="checkbox" name="leaderRegistrationEnabled" defaultChecked={selected.leaderRegistrationEnabled} />
              <span>Manually enable leader registration</span>
            </label>
            <div className="configuration-time-grid">
              <label>
                Opens at
                <input name="leaderRegistrationOpensAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.leaderRegistrationOpensAt)} />
              </label>
              <label>
                Closes at (optional)
                <input name="leaderRegistrationClosesAt" type="datetime-local" defaultValue={datetimeLocalInputFromIso(selected.leaderRegistrationClosesAt)} />
              </label>
            </div>
            <label>
              Public header content
              <textarea name="leaderRegistrationHeaderContent" rows={6} maxLength={10_000} defaultValue={selected.leaderRegistrationHeaderContent} required />
            </label>
            <label>
              Closed/countdown message
              <textarea name="leaderRegistrationClosedMessage" rows={3} maxLength={2_000} defaultValue={selected.leaderRegistrationClosedMessage} required />
            </label>
          </fieldset>

          <h3 style={{ marginBottom: 0 }}>Camper pricing</h3>
          <p className="muted" style={{ margin: 0 }}>
            These prices appear in the info popup beside Amount owed when adding a camper.
          </p>
          <label>
            Early fee for 1st-2nd camper
            <input
              name="earlyCamperFee"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="blank = not configured"
              defaultValue={dollarsInputFromCents(selected.earlyCamperFeeCents)}
            />
          </label>
          <label>
            Late fee for 1st-2nd camper
            <input
              name="lateCamperFee"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="blank = not configured"
              defaultValue={dollarsInputFromCents(selected.lateCamperFeeCents)}
            />
          </label>
          <label>
            Fee for 3rd+ camper
            <input
              name="thirdPlusCamperFee"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="blank = not configured"
              defaultValue={dollarsInputFromCents(selected.thirdPlusCamperFeeCents)}
            />
          </label>
          <label>
            Early-to-late pricing cutover (optional)
            <input
              name="feeCutoverAt"
              type="datetime-local"
              defaultValue={datetimeLocalInputFromIso(selected.feeCutoverAt)}
            />
          </label>
          <label className="row" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="checkInFamilyPaymentOptionEnabled"
              defaultChecked={selected.checkInFamilyPaymentOptionEnabled === true}
            />
            <span>
              Show{" "}
              <strong>
                Check all campers with this parent/guardian email in and mark them paid (cash)
              </strong>{" "}
              on the staff Check-in page.
            </span>
          </label>
          <label className="row" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              name="checkInConfirmationEmailsEnabled"
              defaultChecked={selected.checkInConfirmationEmailsEnabled === true}
            />
            <span>
              Send guardian confirmation emails after camper check-in. Turning this off only disables
              app-managed email delivery; Stripe payment receipt emails are not affected.
            </span>
          </label>
          <div className="row">
            <button type="submit" className="btn">
              Save changes
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={deletingCampYear}
              onClick={openCampYearDeleteDialog}
            >
              {deletingCampYear ? "Deleting…" : "Delete entire camp year"}
            </button>
          </div>
        </form>
      ) : null}

      {selected ? <MerchandiseCatalogEditor campYearId={selected.id} canEdit={superAdmin} /> : null}

      {!superAdmin && selected ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Fee placeholders and capacity are managed by super admins. You can still add campers and
            workers from <strong>People</strong> according to your role.
          </p>
        </div>
      ) : null}

      {bracketToDelete ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && deletingBracketId === null) {
              setBracketToDelete(null);
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-age-group-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-age-group-title" style={{ marginTop: 0 }}>
              Delete age group?
            </h2>
            <p style={{ margin: 0 }}>
              Delete <strong>{bracketToDelete.label}</strong>? Dorms using it will keep their people
              but no longer have an age group.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={deletingBracketId !== null}
                onClick={() => setBracketToDelete(null)}
              >
                Cancel
              </button>
              <button
                ref={deleteBracketConfirmRef}
                type="button"
                className="btn danger"
                disabled={deletingBracketId !== null}
                onClick={() => void handleDeleteBracket()}
              >
                {deletingBracketId !== null ? "Deleting…" : "Delete age group"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {campYearDeleteDialog ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCampYearDeleteDialog();
            }
          }}
        >
          <div
            className="card stack modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camp-year-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {campYearDeleteDialog.step === "warning" ? (
              <>
                <h2 id="camp-year-delete-title" style={{ marginTop: 0 }}>
                  Delete entire camp year?
                </h2>
                <p style={{ margin: 0 }}>
                  This permanently deletes <strong>{campYearDeleteDialog.confirmationLabel}</strong>{" "}
                  and every camper, worker, dorm leader, dorm, age group, and related record for it.
                </p>
                <p className="error" style={{ margin: 0 }}>
                  This cannot be undone.
                </p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button type="button" className="btn secondary" onClick={closeCampYearDeleteDialog}>
                    Cancel
                  </button>
                  <button
                    ref={campYearDeleteContinueRef}
                    type="button"
                    className="btn danger"
                    onClick={() =>
                      setCampYearDeleteDialog({
                        ...campYearDeleteDialog,
                        step: "type_confirmation",
                      })
                    }
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <form className="stack" onSubmit={(event) => void handleDeleteCampYear(event)}>
                <h2 id="camp-year-delete-title" style={{ marginTop: 0 }}>
                  Confirm permanent deletion
                </h2>
                <label className="stack">
                  Type <strong>{campYearDeleteDialog.confirmationLabel}</strong> to confirm
                  <input
                    ref={campYearDeleteInputRef}
                    value={campYearDeleteConfirmation}
                    onChange={(event) => setCampYearDeleteConfirmation(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={deletingCampYear}
                    onClick={closeCampYearDeleteDialog}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn danger"
                    disabled={
                      deletingCampYear ||
                      campYearDeleteConfirmation !== campYearDeleteDialog.confirmationLabel
                    }
                  >
                    {deletingCampYear ? "Deleting…" : "Permanently delete camp year"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
