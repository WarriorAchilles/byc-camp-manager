import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";

type CampMeta = {
  campYear: {
    name: string;
    yearLabel: string;
  };
};

type SelfSearchRow = {
  id: string;
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  checkInStatus: string;
};

type SelfCheckInResponse = {
  camper: {
    firstName: string;
    lastName: string;
    middleInitial: string | null;
    checkInStatus: string;
    dormAssignment: string | null;
  };
  alreadyCheckedIn: boolean;
  checkInCompletedThisRequest: boolean;
  dormAutoAssigned: boolean;
};

function displayName(row: Pick<SelfSearchRow, "firstName" | "lastName" | "middleInitial">): string {
  const mid = row.middleInitial ? ` ${row.middleInitial}.` : "";
  return `${row.firstName}${mid} ${row.lastName}`;
}

export function CamperSelfCheckInPage(): ReactElement {
  const params = useParams();
  const token = params.token ?? "";

  const [meta, setMeta] = useState<CampMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SelfSearchRow[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [busyCamperId, setBusyCamperId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [success, setSuccess] = useState<{
    message: string;
    dormLabel: string;
    dormAutoAssigned: boolean;
  } | null>(null);

  const basePath = useMemo(
    () => `/api/public/self-check-in/${encodeURIComponent(token)}`,
    [token],
  );

  const loadMeta = useCallback(async (): Promise<void> => {
    setMetaError(null);
    setMeta(null);
    try {
      const data = await apiJson<CampMeta>(`${basePath}/meta`);
      setMeta(data);
    } catch (err) {
      const status = (err as ApiHttpError).status;
      setMetaError(
        status === 404
          ? "This check-in link is not valid. Ask camp staff for the current QR code."
          : err instanceof Error
            ? err.message
            : "Could not load camp information.",
      );
    }
  }, [basePath]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const runSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    setSuccess(null);
    setActionError(null);
    const query = searchQuery.trim();
    if (!query) {
      setSearchError("Enter part of your first or last name.");
      return;
    }
    setSearching(true);
    try {
      const data = await apiJson<{ campers: SelfSearchRow[] }>(
        `${basePath}/search?q=${encodeURIComponent(query)}`,
      );
      setResults(data.campers);
      if (data.campers.length === 0) {
        setSearchError("No matches. Try a different spelling or ask staff for help.");
      }
    } catch (err) {
      const status = (err as ApiHttpError).status;
      if (status === 404) {
        setSearchError("This link is no longer valid.");
      } else if (status === 400) {
        setSearchError("Enter a search term.");
      } else {
        setSearchError(err instanceof Error ? err.message : "Search failed.");
      }
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const checkIn = async (camperId: string): Promise<void> => {
    setActionError(null);
    setSuccess(null);
    setBusyCamperId(camperId);
    try {
      const data = await apiJson<SelfCheckInResponse>(`${basePath}/campers/${camperId}/check-in`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const dormLabel = data.camper.dormAssignment ?? "Unassigned";
      if (data.checkInCompletedThisRequest) {
        setSuccess({
          message: `Welcome, ${displayName(data.camper)}!`,
          dormLabel,
          dormAutoAssigned: data.dormAutoAssigned,
        });
        setResults((previous) =>
          previous.map((row) =>
            row.id === camperId ? { ...row, checkInStatus: "checked_in" } : row,
          ),
        );
      } else if (data.alreadyCheckedIn) {
        setSuccess({
          message: `${displayName(data.camper)}, you are already checked in.`,
          dormLabel,
          dormAutoAssigned: false,
        });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed.");
    } finally {
      setBusyCamperId(null);
    }
  };

  if (metaError) {
    return (
      <main className="self-check-in-page">
        <div className="self-check-in-card card">
          <h1 className="self-check-in-title">Check-in</h1>
          <p className="form-error" role="alert">
            {metaError}
          </p>
        </div>
      </main>
    );
  }

  if (!meta) {
    return (
      <main className="self-check-in-page" aria-busy="true">
        <div className="self-check-in-card card">
          <p className="muted">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="self-check-in-page">
      <div className="self-check-in-card card">
        <header className="self-check-in-header">
          <p className="page-header-eyebrow">Camper self check-in</p>
          <h1 className="self-check-in-title">{meta.campYear.name}</h1>
          <p className="muted self-check-in-sub">{meta.campYear.yearLabel}</p>
        </header>

        <p className="self-check-in-lead">
          Search for your name, then tap <strong>Check in</strong>. Your dorm assignment appears after you
          check in.
        </p>

        {success ? (
          <section className="self-check-in-success" aria-live="polite">
            <p className="self-check-in-success-message">{success.message}</p>
            <p className="self-check-in-dorm">
              <span className="self-check-in-dorm-label">Your dorm</span>
              <span className="self-check-in-dorm-value">{success.dormLabel}</span>
            </p>
            {success.dormAutoAssigned ? (
              <p className="muted self-check-in-hint">We just placed you in this dorm based on camp rules.</p>
            ) : null}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setSuccess(null);
                setSearchQuery("");
                setResults([]);
              }}
            >
              Check in someone else
            </button>
          </section>
        ) : (
          <>
            <form className="stack self-check-in-search" onSubmit={(event) => void runSearch(event)}>
              <label className="field-label" htmlFor="self-name-search">
                Your name
              </label>
              <div className="check-in-search-row">
                <input
                  id="self-name-search"
                  className="field-control"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="First or last name"
                  autoComplete="name"
                  enterKeyHint="search"
                />
                <button type="submit" className="btn primary" disabled={searching}>
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              {searchError ? (
                <p className="form-error" role="alert">
                  {searchError}
                </p>
              ) : null}
            </form>

            {actionError ? (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            ) : null}

            {results.length > 0 ? (
              <ul className="check-in-result-list self-check-in-results">
                {results.map((row) => {
                  const checkedIn = row.checkInStatus === "checked_in";
                  return (
                    <li key={row.id}>
                      <div className="self-check-in-row">
                        <div>
                          <div className="self-check-in-name">{displayName(row)}</div>
                          {checkedIn ? (
                            <span className="self-check-in-badge self-check-in-badge-done">Checked in</span>
                          ) : (
                            <span className="self-check-in-badge">Not checked in yet</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn primary"
                          disabled={checkedIn || busyCamperId !== null}
                          onClick={() => void checkIn(row.id)}
                        >
                          {busyCamperId === row.id ? "Working…" : checkedIn ? "Done" : "Check in"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
