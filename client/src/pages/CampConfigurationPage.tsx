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

  const selected = campYears.find((year) => year.id === selectedId) ?? null;

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
        Super admins edit camp-wide settings for each year. Camp admins can review counts but cannot
        change fee placeholders or capacity here.
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
