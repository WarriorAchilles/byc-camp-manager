import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiJson, type ApiHttpError } from "../api";
import { resolveCampYearSelection } from "../campYearSelection";

type CampYear = { id: string; name: string; yearLabel: string; startDate: string };
type Church = {
  id: string;
  name: string;
  pastorName: string;
  reviewedAt: string | null;
  aliases: Array<{ id: string; name: string; pastorName: string }>;
  counts: { campers: number; workers: number; leaders: number; payments: number };
};
type CleanupPerson = {
  id: string;
  type: "camper" | "worker" | "dorm_leader";
  firstName: string;
  lastName: string;
  churchName: string | null;
  pastorName: string | null;
  church?: { name: string; pastorName: string } | null;
};
type Cleanup = {
  unmapped: CleanupPerson[];
  differing: CleanupPerson[];
  unreviewedChurches: Array<{ id: string; name: string; pastorName: string }>;
  likelyDuplicates: Array<{
    sourceChurchId: string;
    targetChurchId: string;
    source: string;
    target: string;
    signals: string[];
  }>;
};
type CamperBalance = {
  id: string;
  firstName: string;
  lastName: string;
  guardianName: string;
  guardianEmail: string;
  feeDueCents: number | null;
  feePaidCents: number | null;
  remainingRegistrationFeeCents: number;
  balanceState: "unpaid" | "partially_paid" | "paid";
  familyMerchandiseBalanceCents: number;
  checkInStatus: string;
};
type Payment = {
  id: string;
  tender: "check" | "cash";
  amountReceivedCents: number;
  receivedDate: string;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  enteredBy: { username: string };
  voidedBy: { username: string } | null;
  allocations: Array<{
    id: string;
    appliedAmountCents: number;
    camper: { id: string; firstName: string; lastName: string };
  }>;
};

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ChurchDirectoryPage(): React.ReactElement {
  const [years, setYears] = useState<CampYear[]>([]);
  const [campYearId, setCampYearId] = useState("");
  const [churches, setChurches] = useState<Church[]>([]);
  const [cleanup, setCleanup] = useState<Cleanup | null>(null);
  const [selectedChurchId, setSelectedChurchId] = useState("");
  const [campers, setCampers] = useState<CamperBalance[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedCamperIds, setSelectedCamperIds] = useState<Set<string>>(new Set());
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [tender, setTender] = useState<"check" | "cash">("check");
  const [receivedDate, setReceivedDate] = useState(today());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [amountCents, setAmountCents] = useState(0);
  const [remapSelection, setRemapSelection] = useState<Set<string>>(new Set());
  const [remapTarget, setRemapTarget] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDirectory = useCallback(async (yearId: string) => {
    if (!yearId) return;
    const query = `?campYearId=${encodeURIComponent(yearId)}`;
    const [directory, cleanupData] = await Promise.all([
      apiJson<{ churches: Church[] }>(`/api/admin/churches${query}`),
      apiJson<Cleanup>(`/api/admin/churches/cleanup${query}`),
    ]);
    setChurches(directory.churches);
    setCleanup(cleanupData);
    setRemapTarget((current) => current || directory.churches[0]?.id || "");
    setMergeTarget((current) => current || directory.churches[0]?.id || "");
  }, []);

  const loadDetails = useCallback(async (churchId: string, yearId: string) => {
    if (!churchId || !yearId) {
      setCampers([]);
      setPayments([]);
      return;
    }
    const result = await apiJson<{ campers: CamperBalance[]; payments: Payment[] }>(
      `/api/admin/churches/${churchId}/details?campYearId=${encodeURIComponent(yearId)}`,
    );
    setCampers(result.campers);
    setPayments(result.payments);
    const ids = new Set(result.campers.filter((camper) =>
      camper.remainingRegistrationFeeCents > 0).map((camper) => camper.id));
    setSelectedCamperIds(ids);
    const nextAllocations = Object.fromEntries(result.campers.map((camper) => [
      camper.id,
      camper.remainingRegistrationFeeCents,
    ]));
    setAllocations(nextAllocations);
    setAmountCents(result.campers.reduce((sum, camper) =>
      sum + (ids.has(camper.id) ? camper.remainingRegistrationFeeCents : 0), 0));
  }, []);

  useEffect(() => {
    void apiJson<{ campYears: CampYear[]; activeCampYearId: string | null }>("/api/admin/camp-years")
      .then((result) => {
        setYears(result.campYears);
        setCampYearId((current) =>
          resolveCampYearSelection(result.campYears, result.activeCampYearId, current));
      })
      .catch(() => setError("Camp years could not be loaded."));
  }, []);

  useEffect(() => {
    setError("");
    void loadDirectory(campYearId).catch(() => setError("The church directory could not be loaded."));
  }, [campYearId, loadDirectory]);

  useEffect(() => {
    void loadDetails(selectedChurchId, campYearId)
      .catch(() => setError("Church payment details could not be loaded."));
  }, [selectedChurchId, campYearId, loadDetails]);

  const selectedCombinedBalance = useMemo(() => campers.reduce((sum, camper) =>
    sum + (selectedCamperIds.has(camper.id) ? camper.remainingRegistrationFeeCents : 0), 0),
  [campers, selectedCamperIds]);

  const explicitAllocationsRequired = amountCents !== selectedCombinedBalance;

  const toggleCamper = (camper: CamperBalance): void => {
    setSelectedCamperIds((current) => {
      const next = new Set(current);
      if (next.has(camper.id)) next.delete(camper.id);
      else next.add(camper.id);
      const selectedTotal = campers.reduce((sum, row) =>
        sum + (next.has(row.id) ? row.remainingRegistrationFeeCents : 0), 0);
      setAmountCents(selectedTotal);
      return next;
    });
  };

  const refresh = async (): Promise<void> => {
    await loadDirectory(campYearId);
    await loadDetails(selectedChurchId, campYearId);
  };

  const rename = async (church: Church): Promise<void> => {
    const name = window.prompt("Canonical church name", church.name)?.trim();
    if (!name) return;
    const pastorName = window.prompt("Canonical pastor name", church.pastorName)?.trim();
    if (!pastorName) return;
    if (!window.confirm(`Rename to ${name} - ${pastorName}? The prior identity will remain an alias.`)) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/admin/churches/${church.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, pastorName }),
      });
      setNotice("Canonical church identity updated.");
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remap = async (): Promise<void> => {
    const people = [...(cleanup?.unmapped ?? []), ...(cleanup?.differing ?? [])]
      .filter((person) => remapSelection.has(`${person.type}:${person.id}`))
      .map(({ type, id }) => ({ type, id }));
    if (!remapTarget || people.length === 0) return;
    if (!window.confirm(`Remap ${people.length} selected attendee(s) to the chosen canonical church?`)) return;
    setBusy(true);
    try {
      await apiJson("/api/admin/churches/remap", {
        method: "POST",
        body: JSON.stringify({ churchId: remapTarget, people }),
      });
      setRemapSelection(new Set());
      setNotice("Selected attendees remapped.");
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const merge = async (): Promise<void> => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    setBusy(true);
    setError("");
    try {
      const preview = await apiJson<{
        target: { name: string; pastorName: string };
        sources: Array<{ name: string; pastorName: string }>;
        affected: {
          campers: unknown[];
          workers: unknown[];
          leaders: unknown[];
          payments: unknown[];
        };
      }>("/api/admin/churches/merge/preview", {
        method: "POST",
        body: JSON.stringify({ sourceChurchIds: [mergeSource], targetChurchId: mergeTarget }),
      });
      const confirmed = window.confirm(
        `Merge ${preview.sources[0]!.name} - ${preview.sources[0]!.pastorName} into `
        + `${preview.target.name} - ${preview.target.pastorName}?\n\n`
        + `Affected records: ${preview.affected.campers.length} camper year groups, `
        + `${preview.affected.workers.length} worker year groups, `
        + `${preview.affected.leaders.length} leader year groups, `
        + `${preview.affected.payments.length} payments.`,
      );
      if (!confirmed) return;
      await apiJson("/api/admin/churches/merge", {
        method: "POST",
        body: JSON.stringify({
          sourceChurchIds: [mergeSource],
          targetChurchId: mergeTarget,
          confirm: true,
        }),
      });
      setMergeSource("");
      setNotice("Churches merged. The source identity remains a redirect.");
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedChurchId) return;
    const paymentAllocations = [...selectedCamperIds].map((camperId) => ({
      camperId,
      appliedAmountCents: explicitAllocationsRequired
        ? Math.max(0, allocations[camperId] ?? 0)
        : campers.find((camper) => camper.id === camperId)!.remainingRegistrationFeeCents,
    })).filter((allocation) => allocation.appliedAmountCents > 0);
    if (paymentAllocations.reduce((sum, allocation) => sum + allocation.appliedAmountCents, 0) !== amountCents) {
      setError("Per-camper allocations must equal the received amount.");
      return;
    }
    if (!window.confirm(`Record a ${tender} payment of ${money(amountCents)} across ${paymentAllocations.length} camper(s)?`)) return;
    setBusy(true);
    setError("");
    try {
      await apiJson(`/api/admin/churches/${selectedChurchId}/payments`, {
        method: "POST",
        body: JSON.stringify({
          campYearId,
          tender,
          amountReceivedCents: amountCents,
          receivedDate,
          referenceNumber: tender === "check" ? referenceNumber : null,
          notes: notes || null,
          idempotencyKey: crypto.randomUUID(),
          allocations: paymentAllocations,
        }),
      });
      setReferenceNumber("");
      setNotes("");
      setNotice("Church payment recorded and camper balances updated.");
      await refresh();
    } catch (caught) {
      const apiError = caught as ApiHttpError;
      const body = apiError.body as { fields?: Array<{ message: string }> } | null;
      setError(body?.fields?.[0]?.message ?? apiError.message);
    } finally {
      setBusy(false);
    }
  };

  const voidPayment = async (payment: Payment): Promise<void> => {
    const reason = window.prompt("Reason for voiding this payment")?.trim();
    if (!reason || !window.confirm("Void this payment and reverse its camper allocations?")) return;
    setBusy(true);
    try {
      await apiJson(`/api/admin/churches/payments/${payment.id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setNotice("Payment voided and balances restored.");
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cleanupPeople = [...(cleanup?.unmapped ?? []), ...(cleanup?.differing ?? [])];

  return (
    <section>
      <div className="page-header">
        <div>
          <p className="eyebrow">Directory and financial operations</p>
          <h1>Churches</h1>
          <p>Canonical identities are global. Counts, cleanup context, and payments use the selected camp year.</p>
        </div>
        <label>Camp year<select value={campYearId} onChange={(event) => setCampYearId(event.target.value)}>
          {years.map((year) => <option key={year.id} value={year.id}>{year.name} ({year.yearLabel})</option>)}
        </select></label>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="success" role="status">{notice}</p> : null}

      <div className="panel table-scroll">
        <h2>Canonical church directory</h2>
        <table className="report-table">
          <thead><tr><th>Church</th><th>Pastor</th><th>Aliases</th><th>People</th><th>Payments</th><th>Actions</th></tr></thead>
          <tbody>{churches.map((church) => (
            <tr key={church.id}>
              <td>{church.name}{!church.reviewedAt ? <small> · New/unreviewed</small> : null}</td>
              <td>{church.pastorName}</td>
              <td>{church.aliases.map((alias) => `${alias.name} - ${alias.pastorName}`).join("; ") || "—"}</td>
              <td>{church.counts.campers} campers · {church.counts.workers} workers · {church.counts.leaders} leaders</td>
              <td>{church.counts.payments}</td>
              <td><button className="btn secondary" disabled={busy} onClick={() => void rename(church)}>Rename</button>{" "}
                <button className="btn secondary" disabled={busy} onClick={() => setSelectedChurchId(church.id)}>Payments</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Cleanup review</h2>
        <p>{cleanup?.unmapped.length ?? 0} incomplete/unmapped · {cleanup?.differing.length ?? 0} submitted/canonical differences · {cleanup?.likelyDuplicates.length ?? 0} likely duplicate suggestions</p>
        {cleanup?.likelyDuplicates.map((candidate) => (
          <div className="cleanup-candidate" key={`${candidate.sourceChurchId}:${candidate.targetChurchId}`}>
            <strong>{candidate.source}</strong> ↔ <strong>{candidate.target}</strong>
            <span>{candidate.signals.join("; ")}</span>
          </div>
        ))}
        {cleanupPeople.length > 0 ? (
          <>
            <div className="table-scroll"><table className="report-table">
              <thead><tr><th>Select</th><th>Person</th><th>Submitted</th><th>Canonical mapping</th></tr></thead>
              <tbody>{cleanupPeople.map((person) => {
                const key = `${person.type}:${person.id}`;
                return <tr key={key}>
                  <td><input type="checkbox" checked={remapSelection.has(key)} onChange={() => setRemapSelection((current) => {
                    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
                  })} /></td>
                  <td>{person.firstName} {person.lastName} ({person.type.replace("_", " ")})</td>
                  <td>{person.churchName || "Missing"} - {person.pastorName || "Missing"}</td>
                  <td>{person.church ? `${person.church.name} - ${person.church.pastorName}` : "Unmapped"}</td>
                </tr>;
              })}</tbody>
            </table></div>
            <div className="inline-actions">
              <select aria-label="Remap target church" value={remapTarget} onChange={(event) => setRemapTarget(event.target.value)}>
                {churches.map((church) => <option key={church.id} value={church.id}>{church.name} - {church.pastorName}</option>)}
              </select>
              <button className="btn" disabled={busy || remapSelection.size === 0} onClick={() => void remap()}>Remap selected</button>
            </div>
          </>
        ) : null}
        <h3>Merge duplicate churches</h3>
        <div className="inline-actions">
          <select aria-label="Merge source" value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}>
            <option value="">Source church</option>
            {churches.map((church) => <option key={church.id} value={church.id}>{church.name} - {church.pastorName}</option>)}
          </select>
          <span>into</span>
          <select aria-label="Merge survivor" value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            {churches.map((church) => <option key={church.id} value={church.id}>{church.name} - {church.pastorName}</option>)}
          </select>
          <button className="btn" disabled={busy || !mergeSource || mergeSource === mergeTarget} onClick={() => void merge()}>Preview and merge</button>
        </div>
      </div>

      {selectedChurchId ? (
        <div className="panel">
          <h2>Record church payment</h2>
          <p>Registration fees only. Merchandise remains on the family registration.</p>
          <div className="table-scroll"><table className="report-table">
            <thead><tr><th>Include</th><th>Camper / family</th><th>Due</th><th>Paid</th><th>Remaining</th><th>Merchandise</th><th>Check-in</th>{explicitAllocationsRequired ? <th>Allocation</th> : null}</tr></thead>
            <tbody>{campers.map((camper) => <tr key={camper.id}>
              <td><input type="checkbox" checked={selectedCamperIds.has(camper.id)} onChange={() => toggleCamper(camper)} /></td>
              <td>{camper.firstName} {camper.lastName}<small>{camper.guardianName} · {camper.guardianEmail}</small></td>
              <td>{money(camper.feeDueCents ?? 0)}</td><td>{money(camper.feePaidCents ?? 0)}</td>
              <td>{money(camper.remainingRegistrationFeeCents)} ({camper.balanceState.replace("_", " ")})</td>
              <td>{money(camper.familyMerchandiseBalanceCents)}</td><td>{camper.checkInStatus.replaceAll("_", " ")}</td>
              {explicitAllocationsRequired ? <td><input type="number" min="0" max={camper.remainingRegistrationFeeCents / 100} step="0.01" disabled={!selectedCamperIds.has(camper.id)}
                value={(allocations[camper.id] ?? 0) / 100} onChange={(event) => setAllocations({ ...allocations, [camper.id]: Math.round(Number(event.target.value) * 100) })} /></td> : null}
            </tr>)}</tbody>
          </table></div>
          <p><strong>Selected combined remaining balance:</strong> {money(selectedCombinedBalance)}</p>
          <form className="payment-form" onSubmit={(event) => void recordPayment(event)}>
            <label>Tender<select value={tender} onChange={(event) => setTender(event.target.value as "check" | "cash")}><option value="check">Check</option><option value="cash">Cash</option></select></label>
            <label>Received date<input required type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></label>
            {tender === "check" ? <label>Check/reference number<input required maxLength={100} value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} /></label> : null}
            <label>Amount received<input required type="number" min="0.01" step="0.01" value={amountCents / 100} onChange={(event) => setAmountCents(Math.round(Number(event.target.value) * 100))} /></label>
            <label>Notes (optional)<textarea maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {explicitAllocationsRequired ? <p className="registration-notice">The received amount differs from the selected balance. Review every per-camper allocation; unallocated overpayments are blocked.</p> : null}
            <button className="btn" disabled={busy || selectedCamperIds.size === 0 || amountCents <= 0}>Record payment</button>
          </form>
          <h3>Payment history</h3>
          {payments.map((payment) => <article className="payment-history" key={payment.id}>
            <strong>{money(payment.amountReceivedCents)} · {payment.tender} · {payment.receivedDate.slice(0, 10)}</strong>
            <span>{payment.referenceNumber ? `Reference ${payment.referenceNumber} · ` : ""}Entered by {payment.enteredBy.username}</span>
            <span>{payment.allocations.map((allocation) => `${allocation.camper.firstName} ${allocation.camper.lastName}: ${money(allocation.appliedAmountCents)}`).join("; ")}</span>
            {payment.voidedAt ? <span>Voided by {payment.voidedBy?.username}: {payment.voidReason}</span>
              : <button className="btn secondary" disabled={busy} onClick={() => void voidPayment(payment)}>Void payment</button>}
          </article>)}
        </div>
      ) : null}
    </section>
  );
}
