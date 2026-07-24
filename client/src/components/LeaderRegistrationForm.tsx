import { useEffect, useState, type FormEvent } from "react";
import { apiJson, type ApiHttpError } from "../api";

type LeaderFormOptions = {
  genders: Array<"male" | "female">;
  stateOrProvinceOptions: string[];
  maritalStatuses: string[];
  ageGroupOptions: string[];
  tShirtSizes: string[];
  tShirtGuidance: string;
};

type LeaderDraft = {
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "" | "male" | "female";
  cellPhone: string;
  altPhone: string;
  streetAddress: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
  maritalStatus: string;
  faithServingResponse: string;
  churchName: string;
  pastorName: string;
  pastorPhone: string;
  ageGroupPreference: string;
  tShirtSize: string;
};

const emptyDraft = (): LeaderDraft => ({
  email: "",
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  cellPhone: "",
  altPhone: "",
  streetAddress: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  country: "United States",
  maritalStatus: "",
  faithServingResponse: "",
  churchName: "",
  pastorName: "",
  pastorPhone: "",
  ageGroupPreference: "",
  tShirtSize: "",
});

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15);
}

export function LeaderRegistrationConfirmation({
  registrationId,
}: {
  registrationId: string;
}): React.ReactElement {
  return (
    <div className="leader-registration-form registration-success" role="status">
      <h2>Leader registration received</h2>
      <p>
        <strong>Registration reference:</strong> {registrationId}
      </p>
      <p>Your answers were saved and are available to camp staff.</p>
    </div>
  );
}

export function LeaderRegistrationForm(): React.ReactElement {
  const [options, setOptions] = useState<LeaderFormOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [draft, setDraft] = useState<LeaderDraft>(emptyDraft);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [registrationId, setRegistrationId] = useState("");

  useEffect(() => {
    void apiJson<LeaderFormOptions>("/api/public/registration/leader/form-options")
      .then((value) => {
        setOptions(value);
        setOptionsError(false);
      })
      .catch(() => setOptionsError(true));
  }, []);

  const update = <K extends keyof LeaderDraft>(key: K, value: LeaderDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await apiJson<{ registrationId: string }>(
        "/api/public/registration/leader",
        {
          method: "POST",
          body: JSON.stringify({
            ...draft,
            submissionKey,
            altPhone: draft.altPhone || null,
            tShirtSize: draft.tShirtSize || null,
          }),
        },
      );
      setRegistrationId(result.registrationId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      const apiError = caught as ApiHttpError;
      const body = apiError.body as {
        error?: string;
        fields?: Array<{ path: string; message: string }>;
      } | null;
      if (body?.error === "registration_closed") {
        setError("Leader registration is no longer open.");
      } else if (body?.error === "leader_already_registered") {
        setError("A leader with this email or matching identity is already registered for this camp.");
      } else if (body?.fields?.[0]?.message) {
        setError(body.fields[0].message);
      } else {
        setError("We could not save this leader registration. Review the form and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (optionsError) {
    return <p role="alert">The leader form options could not be loaded. Please try again shortly.</p>;
  }
  if (!options) return <p aria-busy="true">Loading leader registration form...</p>;
  if (registrationId) {
    return <LeaderRegistrationConfirmation registrationId={registrationId} />;
  }

  return (
    <form className="leader-registration-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="registration-fieldset">
        <legend>Leader information</legend>
        <div className="registration-grid registration-grid-three">
          <label>
            Email
            <input required type="email" autoComplete="email" maxLength={320}
              value={draft.email} onChange={(event) => update("email", event.target.value)} />
          </label>
          <label>
            First name
            <input required autoComplete="given-name" maxLength={100}
              value={draft.firstName} onChange={(event) => update("firstName", event.target.value)} />
          </label>
          <label>
            Last name
            <input required autoComplete="family-name" maxLength={100}
              value={draft.lastName} onChange={(event) => update("lastName", event.target.value)} />
          </label>
          <label>
            Date of birth
            <input required type="date" autoComplete="bday"
              max={new Date().toISOString().slice(0, 10)}
              value={draft.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} />
          </label>
          <label>
            Gender
            <select required value={draft.gender}
              onChange={(event) => update("gender", event.target.value as LeaderDraft["gender"])}>
              <option value="">Select one</option>
              {options.genders.map((gender) => (
                <option key={gender} value={gender}>{gender === "male" ? "Male" : "Female"}</option>
              ))}
            </select>
          </label>
          <label>
            Marital status
            <input required list="leader-marital-status-options" maxLength={100}
              value={draft.maritalStatus}
              onChange={(event) => update("maritalStatus", event.target.value)} />
            <datalist id="leader-marital-status-options">
              {options.maritalStatuses.map((status) => <option key={status} value={status} />)}
            </datalist>
          </label>
          <label>
            Cell number (digits only)
            <input required type="tel" inputMode="numeric" autoComplete="tel"
              minLength={10} maxLength={15} value={draft.cellPhone}
              onChange={(event) => update("cellPhone", digitsOnly(event.target.value))} />
          </label>
          <label>
            Alternate number (optional)
            <input type="tel" inputMode="numeric" minLength={10} maxLength={15}
              value={draft.altPhone}
              onChange={(event) => update("altPhone", digitsOnly(event.target.value))} />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Mailing address</legend>
        <div className="registration-grid">
          <label className="span-two">
            Street address
            <input required autoComplete="street-address" maxLength={200}
              value={draft.streetAddress} onChange={(event) => update("streetAddress", event.target.value)} />
          </label>
          <label>
            City
            <input required autoComplete="address-level2" maxLength={100}
              value={draft.city} onChange={(event) => update("city", event.target.value)} />
          </label>
          <label>
            State or province
            <select required autoComplete="address-level1" value={draft.stateOrProvince}
              onChange={(event) => update("stateOrProvince", event.target.value)}>
              <option value="">Select one</option>
              {options.stateOrProvinceOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Zip or postal code
            <input required autoComplete="postal-code" maxLength={20}
              value={draft.postalCode} onChange={(event) => update("postalCode", event.target.value)} />
          </label>
          <label>
            Country
            <input required autoComplete="country-name" maxLength={100}
              value={draft.country} onChange={(event) => update("country", event.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Faith and church</legend>
        <label>
          How long have you been faithfully serving the Lord?
          <textarea required rows={5} maxLength={4000} value={draft.faithServingResponse}
            onChange={(event) => update("faithServingResponse", event.target.value)} />
        </label>
        <div className="registration-grid">
          <label>
            Church presently attending
            <input required maxLength={200} value={draft.churchName}
              onChange={(event) => update("churchName", event.target.value)} />
          </label>
          <label>
            Pastor name
            <input required maxLength={200} value={draft.pastorName}
              onChange={(event) => update("pastorName", event.target.value)} />
          </label>
          <label>
            Pastor phone number (digits only)
            <input required type="tel" inputMode="numeric" minLength={10} maxLength={15}
              value={draft.pastorPhone}
              onChange={(event) => update("pastorPhone", digitsOnly(event.target.value))} />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Camp preferences</legend>
        <div className="registration-grid">
          <label>
            Which age group would you prefer to work with?
            <input required list="leader-age-group-options" maxLength={100}
              value={draft.ageGroupPreference}
              onChange={(event) => update("ageGroupPreference", event.target.value)} />
            <datalist id="leader-age-group-options">
              {options.ageGroupOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
          </label>
          <label>
            T-shirt size (optional)
            <select value={draft.tShirtSize}
              onChange={(event) => update("tShirtSize", event.target.value)}>
              <option value="">No selection</option>
              {options.tShirtSizes.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="registration-guidance">{options.tShirtGuidance}</p>
      </fieldset>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="registration-actions">
        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit leader registration"}
        </button>
      </div>
    </form>
  );
}
