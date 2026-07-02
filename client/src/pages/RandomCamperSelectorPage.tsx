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

type RandomCamperPoolRow = {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  gender: "male" | "female";
  checkedInAt: string | null;
  dormAssignment: string | null;
};

function randomInt(maxExclusive: number): number {
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

function shuffled<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function camperFullName(camper: RandomCamperPoolRow): string {
  return [camper.firstName, camper.middleName, camper.lastName].filter(Boolean).join(" ");
}

export function RandomCamperSelectorPage(): React.ReactElement {
  const { user } = useAuth();
  const superAdmin = user?.role === "super_admin";

  const [campYears, setCampYears] = useState<CampYearOption[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [randomCamperPool, setRandomCamperPool] = useState<RandomCamperPoolRow[]>([]);
  const [randomPoolError, setRandomPoolError] = useState<string | null>(null);
  const [randomPoolLoading, setRandomPoolLoading] = useState(false);
  const [randomMaleCount, setRandomMaleCount] = useState(1);
  const [randomFemaleCount, setRandomFemaleCount] = useState(1);
  const [randomSelection, setRandomSelection] = useState<RandomCamperPoolRow[]>([]);
  const [randomSelectionError, setRandomSelectionError] = useState<string | null>(null);

  const randomMalePool = useMemo(
    () => randomCamperPool.filter((camper) => camper.gender === "male"),
    [randomCamperPool],
  );
  const randomFemalePool = useMemo(
    () => randomCamperPool.filter((camper) => camper.gender === "female"),
    [randomCamperPool],
  );
  const randomSelectionByGender = useMemo(
    () => ({
      male: randomSelection.filter((camper) => camper.gender === "male"),
      female: randomSelection.filter((camper) => camper.gender === "female"),
    }),
    [randomSelection],
  );

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

  const loadRandomCamperPool = useCallback(async (): Promise<void> => {
    if (!campYearId) {
      setRandomCamperPool([]);
      setRandomSelection([]);
      return;
    }
    setRandomPoolLoading(true);
    try {
      const data = await apiJson<{ campers: RandomCamperPoolRow[] }>(
        `/api/admin/camp-years/${campYearId}/check-in/checked-in-campers`,
      );
      setRandomCamperPool(data.campers);
      setRandomPoolError(null);
      setRandomSelection((previous) =>
        previous.filter((selected) => data.campers.some((camper) => camper.id === selected.id)),
      );
    } catch (err) {
      setRandomCamperPool([]);
      setRandomSelection([]);
      setRandomPoolError(err instanceof Error ? err.message : "Could not load checked-in campers");
    } finally {
      setRandomPoolLoading(false);
    }
  }, [campYearId]);

  useEffect(() => {
    void loadCampYears().catch(() => {
      setCampYears([]);
    });
  }, [loadCampYears]);

  useEffect(() => {
    void loadRandomCamperPool();
  }, [loadRandomCamperPool]);

  const selectRandomCampers = (): void => {
    setRandomSelectionError(null);
    if (!campYearId) {
      setRandomSelectionError("Select a camp year first.");
      return;
    }
    if (randomMaleCount + randomFemaleCount === 0) {
      setRandomSelectionError("Choose at least one camper to select.");
      return;
    }
    if (randomMaleCount > randomMalePool.length) {
      setRandomSelectionError(
        `Only ${randomMalePool.length} checked-in male camper${randomMalePool.length === 1 ? "" : "s"} available.`,
      );
      return;
    }
    if (randomFemaleCount > randomFemalePool.length) {
      setRandomSelectionError(
        `Only ${randomFemalePool.length} checked-in female camper${randomFemalePool.length === 1 ? "" : "s"} available.`,
      );
      return;
    }

    setRandomSelection([
      ...shuffled(randomMalePool).slice(0, randomMaleCount),
      ...shuffled(randomFemalePool).slice(0, randomFemaleCount),
    ]);
  };

  const refreshRandomCampers = async (): Promise<void> => {
    setRandomSelectionError(null);
    await loadRandomCamperPool();
  };

  return (
    <div className="random-camper-page">
      <header className="page-header">
        <p className="page-header-eyebrow">Checked-in campers</p>
        <h1>Random camper selector</h1>
        <p className="page-header-lead">
          Select a configured number of checked-in male and female campers.
        </p>
      </header>

      <div className="card check-in-toolbar">
        {superAdmin ? (
          <>
            <label className="field-label" htmlFor="random-camper-year">
              Camp year
            </label>
            <select
              id="random-camper-year"
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

      <section className="card random-camper-card" aria-labelledby="random-camper-title">
        <div className="random-camper-header">
          <div>
            <h2 id="random-camper-title" className="random-camper-title">
              Selection setup
            </h2>
          </div>
          <button
            type="button"
            className="btn secondary"
            disabled={randomPoolLoading || !campYearId}
            onClick={() => void refreshRandomCampers()}
          >
            {randomPoolLoading ? "Refreshing..." : "Refresh pool"}
          </button>
        </div>

        <div className="random-camper-counts" aria-label="Available checked-in campers">
          <div>
            <span className="check-in-stat-value">{randomMalePool.length}</span>
            <span className="check-in-stat-label">Male campers available</span>
          </div>
          <div>
            <span className="check-in-stat-value">{randomFemalePool.length}</span>
            <span className="check-in-stat-label">Female campers available</span>
          </div>
        </div>

        <div className="random-camper-controls">
          <label className="field-label" htmlFor="random-male-count">
            Male campers
            <input
              id="random-male-count"
              className="field-control"
              type="number"
              min={0}
              max={randomMalePool.length}
              value={randomMaleCount}
              onChange={(event) => {
                const nextValue = event.currentTarget.valueAsNumber;
                setRandomMaleCount(Number.isFinite(nextValue) ? Math.max(0, Math.floor(nextValue)) : 0);
              }}
            />
          </label>
          <label className="field-label" htmlFor="random-female-count">
            Female campers
            <input
              id="random-female-count"
              className="field-control"
              type="number"
              min={0}
              max={randomFemalePool.length}
              value={randomFemaleCount}
              onChange={(event) => {
                const nextValue = event.currentTarget.valueAsNumber;
                setRandomFemaleCount(Number.isFinite(nextValue) ? Math.max(0, Math.floor(nextValue)) : 0);
              }}
            />
          </label>
          <button
            type="button"
            className="btn primary random-camper-draw-button"
            disabled={randomPoolLoading || !campYearId}
            onClick={selectRandomCampers}
          >
            Select campers
          </button>
        </div>

        {randomPoolError ? (
          <p className="form-error" role="alert">
            {randomPoolError}
          </p>
        ) : null}
        {randomSelectionError ? (
          <p className="form-error" role="alert">
            {randomSelectionError}
          </p>
        ) : null}
      </section>

      <section className="card random-camper-card" aria-labelledby="random-camper-results-title">
        <h2 id="random-camper-results-title" className="random-camper-title">
          Selected campers
        </h2>
        {randomSelection.length > 0 ? (
          <div className="random-camper-results" aria-live="polite">
            {randomSelectionByGender.male.length > 0 ? (
              <div>
                <h3>Male campers</h3>
                <ol>
                  {randomSelectionByGender.male.map((camper) => (
                    <li key={camper.id}>
                      <strong>{camperFullName(camper)}</strong>
                      <span className="muted"> - {camper.dormAssignment ?? "Unassigned"}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {randomSelectionByGender.female.length > 0 ? (
              <div>
                <h3>Female campers</h3>
                <ol>
                  {randomSelectionByGender.female.map((camper) => (
                    <li key={camper.id}>
                      <strong>{camperFullName(camper)}</strong>
                      <span className="muted"> - {camper.dormAssignment ?? "Unassigned"}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted random-camper-empty">
            {randomPoolLoading ? "Loading checked-in campers..." : "No campers selected yet."}
          </p>
        )}
      </section>
    </div>
  );
}
