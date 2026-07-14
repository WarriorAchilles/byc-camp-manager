import { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api";

type MerchandiseItem = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  availableOptions: unknown;
  ownership: "family" | "camper";
  isActive: boolean;
  sortOrder: number;
};

type ItemInput = {
  name: string;
  description: string | null;
  priceCents: number;
  availableOptions: string[];
  ownership: "family" | "camper";
  isActive: boolean;
  sortOrder: number;
};

function optionsList(value: unknown): string[] {
  return Array.isArray(value) && value.every((option) => typeof option === "string") ? value : [];
}

function itemInput(form: HTMLFormElement): ItemInput {
  const data = new FormData(form);
  return {
    name: String(data.get("name") ?? "").trim(),
    description: String(data.get("description") ?? "").trim() || null,
    priceCents: Math.round(Number(data.get("price") ?? 0) * 100),
    availableOptions: String(data.get("options") ?? "")
      .split(/\r?\n|,/)
      .map((option) => option.trim())
      .filter((option, index, all) => option.length > 0 && all.indexOf(option) === index),
    ownership: data.get("ownership") === "camper" ? "camper" : "family",
    isActive: data.get("isActive") === "on",
    sortOrder: Number(data.get("sortOrder") ?? 0),
  };
}

export function MerchandiseCatalogEditor({ campYearId, canEdit }: { campYearId: string; canEdit: boolean }): React.ReactElement {
  const [items, setItems] = useState<MerchandiseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await apiJson<{ merchandiseItems: MerchandiseItem[] }>(
        `/api/admin/camp-years/${campYearId}/merchandise`,
      );
      setItems(result.merchandiseItems);
      setError("");
    } catch {
      setError("Merchandise catalog could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [campYearId]);

  useEffect(() => { void load(); }, [load]);

  const createItem = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusyId("new");
    setError("");
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/merchandise`, {
        method: "POST",
        body: JSON.stringify(itemInput(event.currentTarget)),
      });
      event.currentTarget.reset();
      await load();
    } catch {
      setError("Merchandise item could not be created. Check its price and options.");
    } finally {
      setBusyId(null);
    }
  };

  const updateItem = async (event: React.FormEvent<HTMLFormElement>, id: string): Promise<void> => {
    event.preventDefault();
    setBusyId(id);
    setError("");
    try {
      await apiJson(`/api/admin/camp-years/${campYearId}/merchandise/${id}`, {
        method: "PATCH",
        body: JSON.stringify(itemInput(event.currentTarget)),
      });
      await load();
    } catch {
      setError("Merchandise item changes could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  return <section className="card stack merchandise-admin" aria-labelledby="merchandise-catalog-title">
    <div><h2 id="merchandise-catalog-title" style={{ marginBottom: 0 }}>Registration merchandise</h2><p className="muted">Active items appear in optional family pre-order. Prices are snapshotted when a registration is submitted.</p></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {loading ? <p aria-busy="true">Loading merchandise…</p> : null}
    {items.map((item) => <MerchandiseItemForm key={item.id} item={item} canEdit={canEdit} busy={busyId === item.id} onSubmit={(event) => void updateItem(event, item.id)} />)}
    {!loading && items.length === 0 ? <p className="muted">No merchandise items are configured for this camp year.</p> : null}
    {canEdit ? <form className="configuration-fieldset stack" onSubmit={(event) => void createItem(event)}>
      <h3 style={{ margin: 0 }}>Add merchandise item</h3>
      <MerchandiseFields />
      <button className="btn" type="submit" disabled={busyId !== null}>{busyId === "new" ? "Adding…" : "Add item"}</button>
    </form> : null}
  </section>;
}

function MerchandiseItemForm({ item, canEdit, busy, onSubmit }: {
  item: MerchandiseItem;
  canEdit: boolean;
  busy: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}): React.ReactElement {
  return <form className="configuration-fieldset stack" onSubmit={onSubmit}>
    <h3 style={{ margin: 0 }}>{item.name}</h3>
    <MerchandiseFields item={item} disabled={!canEdit} />
    {canEdit ? <button className="btn secondary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save item"}</button> : null}
  </form>;
}

function MerchandiseFields({ item, disabled = false }: { item?: MerchandiseItem; disabled?: boolean }): React.ReactElement {
  return <>
    <div className="registration-grid">
      <label>Name<input name="name" required maxLength={200} defaultValue={item?.name ?? ""} disabled={disabled} /></label>
      <label>Price<input name="price" required type="number" min="0" step="0.01" defaultValue={item ? (item.priceCents / 100).toFixed(2) : ""} disabled={disabled} /></label>
      <label>Ownership<select name="ownership" defaultValue={item?.ownership ?? "family"} disabled={disabled}><option value="family">One family order</option><option value="camper">Select per camper</option></select></label>
      <label>Sort order<input name="sortOrder" type="number" min="0" step="1" defaultValue={item?.sortOrder ?? 0} disabled={disabled} /></label>
    </div>
    <label>Description<textarea name="description" rows={2} maxLength={2000} defaultValue={item?.description ?? ""} disabled={disabled} /></label>
    <label>Options (one per line)<textarea name="options" rows={3} placeholder={"Small\nMedium\nLarge"} defaultValue={optionsList(item?.availableOptions).join("\n")} disabled={disabled} /></label>
    <label className="row"><input name="isActive" type="checkbox" defaultChecked={item?.isActive ?? true} disabled={disabled} />Active and available for registration</label>
  </>;
}
