import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson } from "../api";
import { FamilyRegistrationForm } from "../components/FamilyRegistrationForm";
import { WorkerRegistrationForm } from "../components/WorkerRegistrationForm";
import { LeaderRegistrationForm } from "../components/LeaderRegistrationForm";

type Flow = "family" | "worker" | "leader";
type AvailabilityState =
  | "not_configured"
  | "disabled"
  | "scheduled"
  | "open"
  | "closed"
  | "capacity_reached";

type Availability = {
  flow: Flow;
  state: AvailabilityState;
  serverTime: string;
  opensAt?: string | null;
  closesAt?: string | null;
  headerContent?: string;
  closedMessage?: string;
  camp: null | {
    id: string;
    name: string;
    yearLabel: string;
    startDate: string;
    endDate: string;
  };
};

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}

export function PublicRegistrationPage({ flow }: { flow: Flow }): React.ReactElement {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiJson<Availability>(`/api/public/registration/${flow}`);
      setAvailability(response);
      setServerOffset(new Date(response.serverTime).getTime() - Date.now());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [flow]);

  useEffect(() => { void load(); }, [load]);

  const targetTime = useMemo(() => {
    if (!availability) return null;
    if (availability.state === "scheduled" && availability.opensAt) {
      return new Date(availability.opensAt).getTime();
    }
    if (availability.state === "open" && availability.closesAt) {
      return new Date(availability.closesAt).getTime();
    }
    return null;
  }, [availability]);

  useEffect(() => {
    if (targetTime === null) return;
    let refreshed = false;
    const tick = (): void => {
      const clientNow = Date.now();
      setNow(clientNow);
      if (!refreshed && clientNow + serverOffset >= targetTime) {
        refreshed = true;
        void load();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [load, serverOffset, targetTime]);

  const title = flow === "family"
    ? "Camper registration"
    : flow === "worker"
      ? "Worker registration"
      : "Leader registration";
  const remaining = targetTime === null ? 0 : targetTime - (now + serverOffset);
  const returningFromPayment = flow === "family" && new URLSearchParams(window.location.search).has("registration_id");

  return (
    <main className="registration-page">
      <section className="registration-shell" aria-labelledby="registration-title">
        <img className="registration-logo" src="/byc-logo.png" alt="Believer's Youth Camp" />
        <div className="registration-heading">
          <p className="registration-eyebrow">Public registration</p>
          <h1 id="registration-title">{title}</h1>
          {availability?.camp ? (
            <p>{availability.camp.name} · {availability.camp.yearLabel}</p>
          ) : null}
        </div>

        {availability?.headerContent ? (
          <div className="registration-header-copy">{availability.headerContent}</div>
        ) : null}

        <div className="registration-status" aria-busy={loading}>
          {loading ? <p>Checking registration availability…</p> : null}
          {error ? (
            <div role="alert">
              <h2>Registration is temporarily unavailable</h2>
              <p>Please try again shortly.</p>
              <button className="btn" type="button" onClick={() => void load()}>Try again</button>
            </div>
          ) : null}
          {!loading && !error && !returningFromPayment && availability?.state === "scheduled" ? (
            <div>
              <h2>Registration opens soon</h2>
              <p>{availability.closedMessage}</p>
              <p className="registration-countdown" role="timer" aria-label={`${title} opens in ${formatCountdown(remaining)}`}>
                {formatCountdown(remaining)}
              </p>
            </div>
          ) : null}
          {!loading && !error && returningFromPayment ? (
            <div>
              <FamilyRegistrationForm />
            </div>
          ) : null}
          {!loading && !error && !returningFromPayment && availability?.state === "open" ? (
            <div>
              <h2>{title} is open</h2>
              {flow === "family" ? <FamilyRegistrationForm /> : null}
              {flow === "worker" ? <WorkerRegistrationForm /> : null}
              {flow === "leader" ? <LeaderRegistrationForm /> : null}
            </div>
          ) : null}
          {!loading && !error && !returningFromPayment && availability?.state === "capacity_reached" ? (
            <div role="status">
              <h2>Camper capacity has been reached</h2>
              <p>We cannot accept additional camper registrations at this time.</p>
            </div>
          ) : null}
          {!loading && !error && !returningFromPayment && availability && ["not_configured", "disabled", "closed"].includes(availability.state) ? (
            <div role="status">
              <h2>Registration is closed</h2>
              <p>{availability.closedMessage ?? "Registration is currently closed."}</p>
            </div>
          ) : null}
        </div>

        <nav className="registration-switch" aria-label="Registration options">
          {flow !== "family" ? <Link to="/register/family">Register campers</Link> : null}
          {flow !== "worker" ? <Link to="/register/worker">Register as a worker</Link> : null}
          {flow !== "leader" ? <Link to="/register/leader">Register as a leader</Link> : null}
        </nav>
      </section>
    </main>
  );
}
