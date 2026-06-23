import { FormEvent, useEffect, useState } from "react";
import { apiJson } from "../api";

export type EditablePersonKind = "camper" | "worker" | "dorm_leader";

type DormOption = { id: string; name: string; purpose: string };

type Props = {
  campYearId: string;
  personId: string;
  initialKind: EditablePersonKind;
  personName: string;
  dorms: DormOption[];
  canChangeType: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type Values = Record<string, string | boolean>;

const pathForKind: Record<EditablePersonKind, string> = {
  camper: "campers",
  worker: "workers",
  dorm_leader: "dorm-leaders",
};

function dateValue(value: unknown): string {
  return typeof value === "string" && value ? value.slice(0, 10) : "";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

export function PersonEditDialog({
  campYearId,
  personId,
  initialKind,
  personName,
  dorms,
  canChangeType,
  onClose,
  onSaved,
}: Props): React.ReactElement {
  const [kind, setKind] = useState<EditablePersonKind>(initialKind);
  const [values, setValues] = useState<Values>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await apiJson<Record<string, unknown>>(
          `/api/admin/camp-years/${campYearId}/${pathForKind[initialKind]}/${personId}`,
        );
        setValues({
          firstName: textValue(row.firstName),
          middleName: textValue(row.middleName),
          lastName: textValue(row.lastName),
          gender: textValue(row.gender),
          email: textValue(row.email),
          dateOfBirth: dateValue(row.dateOfBirth),
          streetAddress: textValue(row.streetAddress),
          city: textValue(row.city),
          stateOrProvince: textValue(row.stateOrProvince),
          postalCode: textValue(row.postalCode),
          country: textValue(row.country),
          camperCellPhone: textValue(row.camperCellPhone),
          guardianName: textValue(row.guardianName),
          guardianEmail: textValue(row.guardianEmail),
          guardianPhone: textValue(row.guardianPhone),
          emergencyContactName: textValue(row.emergencyContactName),
          emergencyContactPhone: textValue(row.emergencyContactPhone),
          medicalNotes: textValue(row.medicalNotes),
          dietaryRestrictions: textValue(row.dietaryRestrictions),
          paymentStatus: textValue(row.paymentStatus),
          feeDue: typeof row.feeDueCents === "number" ? String(row.feeDueCents / 100) : "",
          feePaid: typeof row.feePaidCents === "number" ? String(row.feePaidCents / 100) : "",
          dormId: textValue(row.dormId),
          medicalReleaseSigned: row.medicalReleaseSigned === true,
          checkInStatus: textValue(row.checkInStatus),
          cellPhone: textValue(row.cellPhone ?? row.phone),
          altPhone: textValue(row.altPhone),
          taskPreferenceFirst: textValue(row.taskPreferenceFirst),
          taskPreferenceSecond: textValue(row.taskPreferenceSecond),
          taskPreferenceThird: textValue(row.taskPreferenceThird),
          tShirtSize: textValue(row.tShirtSize),
          roleLabel: textValue(row.roleLabel),
          assignedCamperDormId: textValue(row.assignedCamperDormId),
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load this person.");
      } finally {
        setLoading(false);
      }
    })();
  }, [campYearId, initialKind, personId]);

  const value = (name: string): string => String(values[name] ?? "");
  const setValue = (name: string, next: string | boolean): void =>
    setValues((previous) => ({ ...previous, [name]: next }));

  const switchKind = (nextKind: EditablePersonKind): void => {
    setKind(nextKind);
    if (initialKind === "dorm_leader" && nextKind === "worker") {
      setValues((previous) => ({
        ...previous,
        email: previous.email,
        cellPhone: previous.cellPhone,
        dormId: previous.assignedCamperDormId,
      }));
    }
    if (initialKind === "worker" && nextKind === "dorm_leader") {
      setValues((previous) => ({
        ...previous,
        assignedCamperDormId: dorms.some(
          (dorm) => dorm.id === previous.dormId && dorm.purpose === "camper",
        )
          ? previous.dormId
          : "",
      }));
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let path = `/api/admin/camp-years/${campYearId}/${pathForKind[initialKind]}/${personId}`;
      let method = "PATCH";
      let payload: Record<string, unknown>;

      if (kind === "camper") {
        payload = {
          firstName: value("firstName"),
          middleName: nullable(value("middleName")),
          lastName: value("lastName"),
          dateOfBirth: value("dateOfBirth"),
          gender: value("gender"),
          streetAddress: nullable(value("streetAddress")),
          city: nullable(value("city")),
          stateOrProvince: nullable(value("stateOrProvince")),
          postalCode: nullable(value("postalCode")),
          country: nullable(value("country")),
          camperCellPhone: nullable(value("camperCellPhone")),
          guardianName: value("guardianName"),
          guardianEmail: value("guardianEmail"),
          guardianPhone: value("guardianPhone"),
          emergencyContactName: nullable(value("emergencyContactName")),
          emergencyContactPhone: nullable(value("emergencyContactPhone")),
          medicalNotes: nullable(value("medicalNotes")),
          dietaryRestrictions: nullable(value("dietaryRestrictions")),
          paymentStatus: value("paymentStatus"),
          ...(value("feeDue").trim()
            ? { feeDueCents: Math.round(Number(value("feeDue")) * 100) }
            : {}),
          ...(value("feePaid").trim()
            ? { feePaidCents: Math.round(Number(value("feePaid")) * 100) }
            : {}),
          dormId: nullable(value("dormId")),
          medicalReleaseSigned: values.medicalReleaseSigned === true,
          checkInStatus: value("checkInStatus"),
        };
      } else if (kind === "worker") {
        payload = {
          firstName: value("firstName"),
          lastName: value("lastName"),
          email: value("email"),
          gender: value("gender"),
          dateOfBirth: nullable(value("dateOfBirth")),
          cellPhone: value("cellPhone"),
          altPhone: nullable(value("altPhone")),
          streetAddress: value("streetAddress"),
          city: value("city"),
          stateOrProvince: value("stateOrProvince"),
          postalCode: value("postalCode"),
          country: value("country"),
          taskPreferenceFirst: nullable(value("taskPreferenceFirst")),
          taskPreferenceSecond: nullable(value("taskPreferenceSecond")),
          taskPreferenceThird: nullable(value("taskPreferenceThird")),
          tShirtSize: nullable(value("tShirtSize")),
          dormId: nullable(value("dormId")),
        };
        if (initialKind === "worker") payload.checkInStatus = value("checkInStatus");
      } else {
        payload = {
          firstName: value("firstName"),
          lastName: value("lastName"),
          email: value("email"),
          gender: value("gender"),
          phone: value("cellPhone"),
          roleLabel: nullable(value("roleLabel")),
          assignedCamperDormId: nullable(value("assignedCamperDormId")),
        };
        if (initialKind === "dorm_leader") payload.checkInStatus = value("checkInStatus");
      }

      if (kind !== initialKind) {
        method = "POST";
        path += kind === "worker" ? "/convert-to-worker" : "/convert-to-dorm-leader";
      }
      await apiJson(path, { method, body: JSON.stringify(payload) });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this person.");
    } finally {
      setSaving(false);
    }
  };

  const input = (name: string, label: string, required = false, type = "text"): React.ReactElement => (
    <label>{label}<input type={type} value={value(name)} required={required} onChange={(event) => setValue(name, event.target.value)} /></label>
  );
  const genderSelect = <label>Gender<select value={value("gender")} required onChange={(event) => setValue("gender", event.target.value)}><option value="male">Male</option><option value="female">Female</option></select></label>;
  const checkInSelect = <label>Check-in status<select value={value("checkInStatus")} onChange={(event) => setValue("checkInStatus", event.target.value)}><option value="not_checked_in">Not checked in</option><option value="checked_in">Checked in</option></select></label>;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="modal-card stack person-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-person-title" onSubmit={(event) => void submit(event)}>
      <h2 id="edit-person-title" style={{ margin: 0 }}>Edit {personName}</h2>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading ? <>
        <label>Person type<select value={kind} disabled={initialKind === "camper" || !canChangeType} onChange={(event) => switchKind(event.target.value as EditablePersonKind)}>{initialKind === "camper" ? <option value="camper">Camper</option> : <><option value="worker">Worker</option><option value="dorm_leader">Dorm leader</option></>}</select></label>
        <div className="person-edit-grid">
          {input("firstName", "First name", true)}
          {kind === "camper" ? input("middleName", "Middle name") : null}
          {input("lastName", "Last name", true)}
          {genderSelect}
          {kind === "camper" ? <>
            {input("dateOfBirth", "Date of birth", true, "date")}
            {input("camperCellPhone", "Camper cell phone")}
            {input("streetAddress", "Street address")}{input("city", "City")}{input("stateOrProvince", "State / province")}{input("postalCode", "Postal code")}{input("country", "Country")}
            {input("guardianName", "Guardian name")}{input("guardianEmail", "Guardian email", false, "email")}{input("guardianPhone", "Guardian phone")}
            {input("emergencyContactName", "Emergency contact name")}{input("emergencyContactPhone", "Emergency contact phone")}
            <label>Medical notes<textarea value={value("medicalNotes")} onChange={(event) => setValue("medicalNotes", event.target.value)} /></label>
            <label>Dietary restrictions<textarea value={value("dietaryRestrictions")} onChange={(event) => setValue("dietaryRestrictions", event.target.value)} /></label>
            <label>Payment status<select value={value("paymentStatus")} onChange={(event) => setValue("paymentStatus", event.target.value)}><option value="unpaid">Unpaid</option><option value="paid_cash">Paid cash</option><option value="paid_stripe">Paid Stripe</option></select></label>
            {input("feeDue", "Fee due (USD)", false, "number")}
            {input("feePaid", "Fee paid (USD)", false, "number")}
            <label>Dorm<select value={value("dormId")} onChange={(event) => setValue("dormId", event.target.value)}><option value="">Unassigned</option>{dorms.filter((dorm) => dorm.purpose === "camper").map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name}</option>)}</select></label>
            <label className="row"><input type="checkbox" checked={values.medicalReleaseSigned === true} onChange={(event) => setValue("medicalReleaseSigned", event.target.checked)} /> Medical release signed</label>
            {checkInSelect}
          </> : null}
          {kind === "worker" ? <>
            {input("email", "Email", false, "email")}{input("dateOfBirth", "Date of birth", false, "date")}{input("cellPhone", "Cell phone")}{input("altPhone", "Alternate phone")}
            {input("streetAddress", "Street address")}{input("city", "City")}{input("stateOrProvince", "State / province")}{input("postalCode", "Postal code")}{input("country", "Country")}
            {input("taskPreferenceFirst", "First task preference")}{input("taskPreferenceSecond", "Second task preference")}{input("taskPreferenceThird", "Third task preference")}{input("tShirtSize", "T-shirt size")}
            <label>Dorm<select value={value("dormId")} onChange={(event) => setValue("dormId", event.target.value)}><option value="">Unassigned</option>{dorms.map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name} ({dorm.purpose})</option>)}</select></label>
            {initialKind === "worker" ? checkInSelect : null}
          </> : null}
          {kind === "dorm_leader" ? <>
            {input("email", "Email", false, "email")}{input("cellPhone", "Phone")}{input("roleLabel", "Role label")}
            <label>Camper dorm<select value={value("assignedCamperDormId")} onChange={(event) => setValue("assignedCamperDormId", event.target.value)}><option value="">Unassigned</option>{dorms.filter((dorm) => dorm.purpose === "camper").map((dorm) => <option key={dorm.id} value={dorm.id}>{dorm.name}</option>)}</select></label>
            {initialKind === "dorm_leader" ? checkInSelect : null}
          </> : null}
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="btn" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      </> : null}
    </form>
  </div>;
}
