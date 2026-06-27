import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiJson, type ApiHttpError } from "../api";

type CampMeta = {
  campYear: {
    name: string;
    yearLabel: string;
  };
};

type PersonKind = "camper" | "worker" | "dorm_leader";

type SelfSearchRow = {
  id: string;
  personKind: PersonKind;
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  checkInStatus: string;
  dormAssignment: string | null;
};

type SelfCheckedInPerson = {
  id?: string;
  personKind?: PersonKind;
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  checkInStatus: string;
  dormAssignment: string | null;
};

type SelfCheckInResponse = {
  person?: SelfCheckedInPerson;
  camper?: SelfCheckedInPerson;
  alreadyCheckedIn: boolean;
  checkInCompletedThisRequest: boolean;
  dormAutoAssigned: boolean;
};

type BatchSelfCheckInResponse = {
  people?: SelfCheckInResponse[];
  campers?: SelfCheckInResponse[];
};

type PaymentOptionsResponse = {
  camper: {
    id: string;
    firstName: string;
    lastName: string;
    middleInitial: string | null;
    paymentStatus: string;
    checkInStatus: string;
    dormAssignment: string | null;
    remainingBalanceCents: number;
    onlinePaymentAvailable: boolean;
  };
};

type StripeCheckoutResponse = {
  url: string;
  stripeSessionId: string;
  amountCents: number;
};

function displayName(row: Pick<SelfSearchRow, "firstName" | "lastName" | "middleInitial">): string {
  const mid = row.middleInitial ? ` ${row.middleInitial}.` : "";
  return `${row.firstName}${mid} ${row.lastName}`;
}

function personKindLabel(kind: PersonKind | undefined): string {
  if (kind === "worker") {
    return "Worker";
  }
  if (kind === "dorm_leader") {
    return "Dorm leader";
  }
  return "Camper";
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function checkedInPerson(entry: SelfCheckInResponse): SelfCheckedInPerson {
  return entry.person ?? entry.camper!;
}

export function CamperSelfCheckInPage(): ReactElement {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = params.token ?? "";

  const [meta, setMeta] = useState<CampMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SelfSearchRow[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [busyPersonId, setBusyPersonId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedPeople, setSelectedPeople] = useState<SelfSearchRow[]>([]);
  const [selectedPayments, setSelectedPayments] = useState<PaymentOptionsResponse["camper"][]>([]);
  const [manualPaymentAccepted, setManualPaymentAccepted] = useState(false);

  const [success, setSuccess] = useState<{
    message: string;
    people: Array<{
      name: string;
      role: string;
      dormLabel: string;
    }>;
    dormAutoAssigned: boolean;
  } | null>(null);

  const basePath = useMemo(
    () => `/api/public/self-check-in/${encodeURIComponent(token)}`,
    [token],
  );
  const selectedPersonIds = useMemo(
    () => selectedPeople.map((person) => person.id),
    [selectedPeople],
  );
  const selectedCamperIds = useMemo(
    () => selectedPeople.filter((person) => person.personKind === "camper").map((person) => person.id),
    [selectedPeople],
  );
  const selectedWorkerIds = useMemo(
    () => selectedPeople.filter((person) => person.personKind === "worker").map((person) => person.id),
    [selectedPeople],
  );
  const selectedDormLeaderIds = useMemo(
    () => selectedPeople.filter((person) => person.personKind === "dorm_leader").map((person) => person.id),
    [selectedPeople],
  );
  const unselectedResults = useMemo(
    () => results.filter((row) => !selectedPersonIds.includes(row.id)),
    [results, selectedPersonIds],
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

  useEffect(() => {
    const stripeState = searchParams.get("stripe");
    const stripeSessionId = searchParams.get("session_id");
    if (stripeState === "cancel") {
      setActionError("Online payment was canceled. You can still pay online or choose manual payment.");
      setSearchParams({}, { replace: true });
      return;
    }
    if (stripeState !== "success" || !stripeSessionId) {
      return;
    }

    let active = true;
    setBusyPersonId("stripe-status");
    setActionError(null);
    void apiJson<{
      completed: boolean;
      campers?: Array<SelfCheckedInPerson & { paymentStatus: string }>;
      camper: SelfCheckedInPerson & { paymentStatus: string };
    }>(`${basePath}/stripe-checkout/${encodeURIComponent(stripeSessionId)}/status`)
      .then((data) => {
        if (!active) {
          return;
        }
        if (data.completed) {
          const checkedInCampers =
            "campers" in data && Array.isArray(data.campers) && data.campers.length > 0
              ? data.campers
              : [data.camper];
          const camperCount = checkedInCampers.length;
          setSuccess({
            message:
              camperCount > 1
                ? `Payment received. ${camperCount} campers are checked in.`
                : `Payment received. Welcome, ${displayName(data.camper)}!`,
            people: checkedInCampers.map((camper) => ({
              name: displayName(camper),
              role: "Camper",
              dormLabel: camper.dormAssignment ?? "Unassigned",
            })),
            dormAutoAssigned: false,
          });
          setResults([]);
          setSelectedPeople([]);
          setSelectedPayments([]);
          setSearchParams({}, { replace: true });
        } else {
          setActionError("Stripe has not confirmed payment yet. Try refreshing in a moment.");
        }
      })
      .catch((err) => {
        if (active) {
          setActionError(err instanceof Error ? err.message : "Could not confirm Stripe payment.");
        }
      })
      .finally(() => {
        if (active) {
          setBusyPersonId(null);
        }
      });

    return () => {
      active = false;
    };
  }, [basePath, searchParams, setSearchParams]);

  const runSearch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSearchError(null);
    setSuccess(null);
    setActionError(null);
    setSelectedPayments([]);
    setManualPaymentAccepted(false);
    const query = searchQuery.trim();
    if (!query) {
      setSearchError("Enter part of your first or last name.");
      return;
    }
    setSearching(true);
    try {
      const data = await apiJson<{ people?: SelfSearchRow[]; campers?: SelfSearchRow[] }>(
        `${basePath}/search?q=${encodeURIComponent(query)}`,
      );
      const people = (data.people ?? data.campers ?? []).map((row) => ({
        ...row,
        personKind: row.personKind ?? "camper",
      }));
      setResults(people);
      if (people.length === 0) {
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

  const toggleSelectedPerson = (person: SelfSearchRow): void => {
    setActionError(null);
    setSelectedPayments([]);
    setManualPaymentAccepted(false);
    setSelectedPeople((previous) =>
      previous.some((selectedPerson) => selectedPerson.id === person.id)
        ? previous.filter((selectedPerson) => selectedPerson.id !== person.id)
        : [...previous, person],
    );
  };

  const showPaymentOptions = async (): Promise<void> => {
    setActionError(null);
    setSuccess(null);
    setManualPaymentAccepted(false);
    setSelectedPayments([]);
    if (selectedPersonIds.length === 0) {
      setActionError("Select at least one person.");
      return;
    }
    setBusyPersonId("selected");
    try {
      const paymentOptions = await Promise.all(
        selectedCamperIds.map((camperId) =>
          apiJson<PaymentOptionsResponse>(`${basePath}/campers/${camperId}/payment-options`),
        ),
      );
      const campers = paymentOptions.map((paymentOption) => paymentOption.camper);
      const needsPayment = campers.some((camper) => camper.paymentStatus === "unpaid");
      if (!needsPayment) {
        await checkInSelected(false);
        return;
      }
      setSelectedPayments(campers);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not load payment options.");
    } finally {
      setBusyPersonId(null);
    }
  };

  const checkInSelected = async (manualPayment: boolean): Promise<void> => {
    setActionError(null);
    setSuccess(null);
    setBusyPersonId("selected");
    try {
      const data = await apiJson<BatchSelfCheckInResponse>(`${basePath}/check-in`, {
        method: "POST",
        body: JSON.stringify({
          camperIds: selectedCamperIds,
          workerIds: selectedWorkerIds,
          dormLeaderIds: selectedDormLeaderIds,
          manualPaymentAccepted: manualPayment || undefined,
        }),
      });
      const entries = data.people ?? data.campers ?? [];
      const checkedInCount = entries.filter(
        (entry) => entry.checkInCompletedThisRequest || entry.alreadyCheckedIn,
      ).length;
      const firstPerson = entries[0] ? checkedInPerson(entries[0]) : null;
      setSuccess({
        message:
          checkedInCount > 1
            ? `${checkedInCount} people are checked in.`
            : firstPerson
              ? `Welcome, ${displayName(firstPerson)}!`
              : "Check-in complete.",
        people: entries.map((entry) => {
          const person = checkedInPerson(entry);
          return {
            name: displayName(person),
            role: personKindLabel(person.personKind),
            dormLabel: person.dormAssignment ?? "Unassigned",
          };
        }),
        dormAutoAssigned: entries.some((entry) => entry.dormAutoAssigned),
      });
      setResults((previous) =>
        previous.map((row) =>
          selectedPersonIds.includes(row.id) ? { ...row, checkInStatus: "checked_in" } : row,
        ),
      );
      setSelectedPeople([]);
      setSelectedPayments([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed.");
    } finally {
      setBusyPersonId(null);
    }
  };

  const startSelectedStripeCheckout = async (): Promise<void> => {
    setActionError(null);
    setBusyPersonId("selected");
    try {
      const data = await apiJson<StripeCheckoutResponse>(`${basePath}/stripe-checkout`, {
        method: "POST",
        body: JSON.stringify({ camperIds: selectedCamperIds }),
      });
      globalThis.location.assign(data.url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start online payment.");
      setBusyPersonId(null);
    }
  };

  const selectedBalanceCents = selectedPayments.reduce(
    (sum, camper) => sum + camper.remainingBalanceCents,
    0,
  );
  const onlinePaymentAvailable = selectedPayments.some((camper) => camper.onlinePaymentAvailable);
  const hasSelectedPeople = selectedPeople.length > 0;
  const hasVisiblePeople = hasSelectedPeople || unselectedResults.length > 0;
  const showCheckedInDorm = (person: SelfSearchRow): void => {
    setActionError(null);
    setSearchError(null);
    setSelectedPeople([]);
    setSelectedPayments([]);
    setManualPaymentAccepted(false);
    setSuccess({
      message: `${displayName(person)} is already checked in.`,
      people: [
        {
          name: displayName(person),
          role: personKindLabel(person.personKind),
          dormLabel: person.dormAssignment ?? "Unassigned",
        },
      ],
      dormAutoAssigned: false,
    });
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
          <p className="muted">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="self-check-in-page">
      <div className="self-check-in-card card">
        <header className="self-check-in-header">
          <p className="page-header-eyebrow">Self check-in</p>
          <h1 className="self-check-in-title">{meta.campYear.name}</h1>
          <p className="muted self-check-in-sub">{meta.campYear.yearLabel}</p>
        </header>

        <p className="self-check-in-lead">
          Search for your name, then tap <strong>Continue</strong> to check in. If you are already checked
          in, tap your name to show your dorm assignment again.
        </p>

        {success ? (
          <section className="self-check-in-success" aria-live="polite">
            <p className="self-check-in-success-message">{success.message}</p>
            <div className="self-check-in-dorm-list">
              {success.people.map((person) => (
                <p className="self-check-in-dorm" key={`${person.name}-${person.role}-${person.dormLabel}`}>
                  <span className="self-check-in-camper-name">{person.name}</span>
                  <span className="self-check-in-badge">{person.role}</span>
                  <span className="self-check-in-dorm-label">Your dorm assignment:</span>
                  <span className="self-check-in-dorm-value">{person.dormLabel}</span>
                </p>
              ))}
            </div>
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
                setSelectedPeople([]);
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
                  {searching ? "Searching..." : "Search"}
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

            {hasVisiblePeople ? (
              <>
                <ul className="check-in-result-list self-check-in-results">
                  {selectedPeople.map((row) => {
                    const checkedIn = row.checkInStatus === "checked_in";
                    return (
                      <li key={row.id}>
                        <label className="self-check-in-row self-check-in-select-row self-check-in-pinned-row">
                          <input
                            type="checkbox"
                            checked
                            disabled={checkedIn || busyPersonId !== null}
                            onChange={() => toggleSelectedPerson(row)}
                          />
                          <div>
                            <div className="self-check-in-name">{displayName(row)}</div>
                            <span className="self-check-in-badge">{personKindLabel(row.personKind)}</span>
                            {checkedIn ? (
                              <span className="self-check-in-badge self-check-in-badge-done">Checked in</span>
                            ) : (
                              <span className="self-check-in-badge">Not checked in yet</span>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                  {unselectedResults.map((row) => {
                    const checkedIn = row.checkInStatus === "checked_in";
                    return (
                      <li key={row.id}>
                        {checkedIn ? (
                          <button
                            type="button"
                            className="self-check-in-row self-check-in-select-row self-check-in-reveal-row"
                            disabled={busyPersonId !== null}
                            onClick={() => showCheckedInDorm(row)}
                          >
                            <div>
                              <div className="self-check-in-name">{displayName(row)}</div>
                              <span className="self-check-in-badge">{personKindLabel(row.personKind)}</span>
                              <span className="self-check-in-badge self-check-in-badge-done">
                                Checked in - tap to show dorm
                              </span>
                            </div>
                          </button>
                        ) : (
                          <label className="self-check-in-row self-check-in-select-row">
                            <input
                              type="checkbox"
                              checked={false}
                              disabled={busyPersonId !== null}
                              onChange={() => toggleSelectedPerson(row)}
                            />
                            <div>
                              <div className="self-check-in-name">{displayName(row)}</div>
                              <span className="self-check-in-badge">{personKindLabel(row.personKind)}</span>
                              <span className="self-check-in-badge">Not checked in yet</span>
                            </div>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="btn primary"
                  disabled={selectedPersonIds.length === 0 || busyPersonId !== null}
                  onClick={() => void showPaymentOptions()}
                >
                  {busyPersonId === "selected"
                    ? "Working..."
                    : selectedPersonIds.length > 1
                      ? `Continue with ${selectedPersonIds.length} people`
                      : "Continue"}
                </button>
              </>
            ) : null}

            {selectedPayments.length > 0 ? (
              <section className="self-check-in-payment" aria-live="polite">
                <h2 className="self-check-in-payment-title">
                  {selectedPayments.length > 1
                    ? `${selectedPayments.length} selected campers`
                    : displayName(selectedPayments[0]!)}
                </h2>
                <p className="muted">
                  The selected registration balance is {formatUsd(selectedBalanceCents)}. Choose how
                  you will handle payment to finish check-in.
                </p>
                {onlinePaymentAvailable ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyPersonId !== null}
                    onClick={() => void startSelectedStripeCheckout()}
                  >
                    Pay online
                  </button>
                ) : (
                  <p className="muted">Online payment is not available for this balance.</p>
                )}
                <label className="check-inline payment-checkbox-button self-check-in-manual-pay">
                  <input
                    type="checkbox"
                    checked={manualPaymentAccepted}
                    onChange={(event) => setManualPaymentAccepted(event.target.checked)}
                  />
                  I am paying by cash or check
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!manualPaymentAccepted || busyPersonId !== null}
                  onClick={() => void checkInSelected(true)}
                >
                  Check in and show dorm
                </button>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
