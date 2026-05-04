import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiJson } from "../api";
import { useAuth } from "../auth";

type CampYearRow = {
  id: string;
  name: string;
  yearLabel: string;
  startDate: string;
  endDate: string;
  camperCapacity: number | null;
  familyRegistrationOpensAt: string | null;
  workerRegistrationOpensAt: string | null;
  feeCutoverAt: string | null;
  earlyCamperFeeCents: number | null;
  lateCamperFeeCents: number | null;
  thirdPlusCamperFeeCents: number | null;
  discountTierNotes: string | null;
  merchandisePlaceholderNotes: string | null;
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

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const data = await apiJson<{ campYears: CampYearRow[] }>("/api/admin/camp-years");
      setCampYears(data.campYears);
      setSelectedId((previous) => {
        if (previous) {
          return previous;
        }
        return data.campYears.length > 0 ? data.campYears[0].id : null;
      });
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
    try {
      await apiJson(`/api/admin/camp-years/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(formData.get("name") ?? "").trim(),
          yearLabel: String(formData.get("yearLabel") ?? "").trim(),
          startDate: String(formData.get("startDate") ?? ""),
          endDate: String(formData.get("endDate") ?? ""),
          camperCapacity: capacityParsed,
          discountTierNotes: String(formData.get("discountTierNotes") ?? "").trim() || null,
          merchandisePlaceholderNotes:
            String(formData.get("merchandisePlaceholderNotes") ?? "").trim() || null,
        }),
      });
      await load();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save camp configuration.";
      setError(message);
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

      <div className="card stack">
        <label htmlFor="campYearPick">Active camp year</label>
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

      {superAdmin ? (
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
          <button type="submit" className="btn">
            Create camp year
          </button>
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
                  <th>Edit</th>
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
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => beginEditBracket(bracket)}
                      >
                        Edit
                      </button>
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
          <label>
            Discount tier notes (placeholder)
            <textarea
              name="discountTierNotes"
              rows={3}
              defaultValue={selected.discountTierNotes ?? ""}
              style={{ width: "100%", maxWidth: "480px" }}
            />
          </label>
          <label>
            Merchandise placeholder notes
            <textarea
              name="merchandisePlaceholderNotes"
              rows={3}
              defaultValue={selected.merchandisePlaceholderNotes ?? ""}
              style={{ width: "100%", maxWidth: "480px" }}
            />
          </label>
          <button type="submit" className="btn">
            Save changes
          </button>
        </form>
      ) : null}

      {!superAdmin && selected ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Fee placeholders and capacity are managed by super admins. You can still add campers and
            workers from <strong>People</strong> according to your role.
          </p>
        </div>
      ) : null}
    </div>
  );
}
