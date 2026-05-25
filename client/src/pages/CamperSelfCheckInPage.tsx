import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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

type BatchSelfCheckInResponse = {
  campers: SelfCheckInResponse[];
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

function formatUsd(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
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

  const [busyCamperId, setBusyCamperId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCampers, setSelectedCampers] = useState<SelfSearchRow[]>([]);
  const [selectedPayments, setSelectedPayments] = useState<PaymentOptionsResponse["camper"][]>([]);
  const [manualPaymentAccepted, setManualPaymentAccepted] = useState(false);

  const [success, setSuccess] = useState<{
    message: string;
    campers: Array<{
      name: string;
      dormLabel: string;
    }>;
    dormAutoAssigned: boolean;
  } | null>(null);

  const basePath = useMemo(
    () => `/api/public/self-check-in/${encodeURIComponent(token)}`,
    [token],
  );
  const selectedCamperIds = useMemo(
    () => selectedCampers.map((camper) => camper.id),
    [selectedCampers],
  );
  const unselectedResults = useMemo(
    () => results.filter((row) => !selectedCamperIds.includes(row.id)),
    [results, selectedCamperIds],
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
    setBusyCamperId("stripe-status");
    setActionError(null);
    void apiJson<{
      completed: boolean;
      campers?: Array<SelfCheckInResponse["camper"] & { paymentStatus: string }>;
      camper: SelfCheckInResponse["camper"] & { paymentStatus: string };
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
            campers: checkedInCampers.map((camper) => ({
              name: displayName(camper),
              dormLabel: camper.dormAssignment ?? "Unassigned",
            })),
            dormAutoAssigned: false,
          });
          setResults([]);
          setSelectedCampers([]);
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
          setBusyCamperId(null);
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

  const toggleSelectedCamper = (camper: SelfSearchRow): void => {
    setActionError(null);
    setSelectedPayments([]);
    setManualPaymentAccepted(false);
    setSelectedCampers((previous) =>
      previous.some((selectedCamper) => selectedCamper.id === camper.id)
        ? previous.filter((selectedCamper) => selectedCamper.id !== camper.id)
        : [...previous, camper],
    );
  };

  const showPaymentOptions = async (): Promise<void> => {
    setActionError(null);
    setSuccess(null);
    setManualPaymentAccepted(false);
    setSelectedPayments([]);
    if (selectedCamperIds.length === 0) {
      setActionError("Select at least one camper.");
      return;
    }
    setBusyCamperId("selected");
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
      setBusyCamperId(null);
    }
  };

  const checkInSelected = async (manualPayment: boolean): Promise<void> => {
    setActionError(null);
    setSuccess(null);
    setBusyCamperId("selected");
    try {
      const data = await apiJson<BatchSelfCheckInResponse>(`${basePath}/check-in`, {
        method: "POST",
        body: JSON.stringify({
          camperIds: selectedCamperIds,
          manualPaymentAccepted: manualPayment || undefined,
        }),
      });
      const checkedInCount = data.campers.filter(
        (entry) => entry.checkInCompletedThisRequest || entry.alreadyCheckedIn,
      ).length;
      const firstCamper = data.campers[0]?.camper;
      setSuccess({
        message:
          checkedInCount > 1
            ? `${checkedInCount} campers are checked in.`
            : firstCamper
              ? `Welcome, ${displayName(firstCamper)}!`
              : "Check-in complete.",
        campers: data.campers.map((entry) => ({
          name: displayName(entry.camper),
          dormLabel: entry.camper.dormAssignment ?? "Unassigned",
        })),
        dormAutoAssigned: data.campers.some((entry) => entry.dormAutoAssigned),
      });
      setResults((previous) =>
        previous.map((row) =>
          selectedCamperIds.includes(row.id) ? { ...row, checkInStatus: "checked_in" } : row,
        ),
      );
      setSelectedCampers([]);
      setSelectedPayments([]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Check-in failed.");
    } finally {
      setBusyCamperId(null);
    }
  };

  const startSelectedStripeCheckout = async (): Promise<void> => {
    setActionError(null);
    setBusyCamperId("selected");
    try {
      const data = await apiJson<StripeCheckoutResponse>(`${basePath}/stripe-checkout`, {
        method: "POST",
        body: JSON.stringify({ camperIds: selectedCamperIds }),
      });
      globalThis.location.assign(data.url);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start online payment.");
      setBusyCamperId(null);
    }
  };

  const selectedBalanceCents = selectedPayments.reduce(
    (sum, camper) => sum + camper.remainingBalanceCents,
    0,
  );
  const onlinePaymentAvailable = selectedPayments.some((camper) => camper.onlinePaymentAvailable);
  const hasSelectedCampers = selectedCampers.length > 0;
  const hasVisibleCampers = hasSelectedCampers || unselectedResults.length > 0;

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
            <div className="self-check-in-dorm-list">
              {success.campers.map((camper) => (
                <p className="self-check-in-dorm" key={`${camper.name}-${camper.dormLabel}`}>
                  <span className="self-check-in-dorm-label">{camper.name}</span>
                  <span className="self-check-in-dorm-value">{camper.dormLabel}</span>
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
                setSelectedCampers([]);
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

            {hasVisibleCampers ? (
              <>
                <ul className="check-in-result-list self-check-in-results">
                  {selectedCampers.map((row) => {
                    const checkedIn = row.checkInStatus === "checked_in";
                    return (
                      <li key={row.id}>
                        <label className="self-check-in-row self-check-in-select-row self-check-in-pinned-row">
                          <input
                            type="checkbox"
                            checked
                            disabled={checkedIn || busyCamperId !== null}
                            onChange={() => toggleSelectedCamper(row)}
                          />
                          <div>
                            <div className="self-check-in-name">{displayName(row)}</div>
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
                        <label className="self-check-in-row self-check-in-select-row">
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={checkedIn || busyCamperId !== null}
                            onChange={() => toggleSelectedCamper(row)}
                          />
                          <div>
                            <div className="self-check-in-name">{displayName(row)}</div>
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
                </ul>
                <button
                  type="button"
                  className="btn primary"
                  disabled={selectedCamperIds.length === 0 || busyCamperId !== null}
                  onClick={() => void showPaymentOptions()}
                >
                  {busyCamperId === "selected"
                    ? "Working…"
                    : selectedCamperIds.length > 1
                      ? `Continue with ${selectedCamperIds.length} campers`
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
                    disabled={busyCamperId !== null}
                    onClick={() => void startSelectedStripeCheckout()}
                  >
                    Pay online
                  </button>
                ) : (
                  <p className="muted">Online payment is not available for this balance.</p>
                )}
                <label className="check-inline self-check-in-manual-pay">
                  <input
                    type="checkbox"
                    checked={manualPaymentAccepted}
                    onChange={(event) => setManualPaymentAccepted(event.target.checked)}
                  />
                  I will pay manually
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!manualPaymentAccepted || busyCamperId !== null}
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
