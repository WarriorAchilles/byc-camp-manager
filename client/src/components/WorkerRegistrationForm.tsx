import { useEffect, useState, type FormEvent } from "react";
import { apiJson, type ApiHttpError } from "../api";
import { ChurchCombobox } from "./ChurchCombobox";

type ConfirmationGuidance = {
  testimony: string;
  rules: string;
  arrival: string;
  payment: string;
};

type WorkerFormOptions = {
  genders: Array<"male" | "female">;
  stateOrProvinceOptions: string[];
  taskOptions: string[];
  tShirtSizes: string[];
  taskGuidance: string;
  tShirtGuidance: string;
  confirmationGuidance: ConfirmationGuidance;
};

type WorkerDraft = {
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
  faithServingResponse: string;
  churchName: string;
  pastorName: string;
  selectedChurchId: string | null;
  pastorPhone: string;
  taskPreferences: [string, string, string];
  tShirtSize: string;
};

const emptyDraft = (): WorkerDraft => ({
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
  faithServingResponse: "",
  churchName: "",
  pastorName: "",
  selectedChurchId: null,
  pastorPhone: "",
  taskPreferences: ["", "", ""],
  tShirtSize: "",
});

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15);
}

export function WorkerRegistrationConfirmation({
  registrationId,
  guidance,
}: {
  registrationId: string;
  guidance: ConfirmationGuidance;
}): React.ReactElement {
  return (
    <div className="worker-registration-form registration-success" role="status">
      <h2>Worker registration received</h2>
      <p>
        <strong>Registration reference:</strong> {registrationId}
      </p>
      <p>
        Your answers were saved. Camp staff may review the submission if it appears to match an
        existing worker record.
      </p>
      <section className="worker-confirmation-next" aria-labelledby="worker-next-steps">
        <h3 id="worker-next-steps">Before camp</h3>
        <p>{guidance.testimony}</p>
        <p>{guidance.rules}</p>
        <p>{guidance.arrival}</p>
        <p>{guidance.payment}</p>
      </section>
    </div>
  );
}

export function WorkerRegistrationForm(): React.ReactElement {
  const [options, setOptions] = useState<WorkerFormOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [draft, setDraft] = useState<WorkerDraft>(emptyDraft);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [registrationId, setRegistrationId] = useState("");

  useEffect(() => {
    void apiJson<WorkerFormOptions>("/api/public/registration/worker/form-options")
      .then((value) => {
        setOptions(value);
        setOptionsError(false);
      })
      .catch(() => setOptionsError(true));
  }, []);

  const update = <K extends keyof WorkerDraft>(key: K, value: WorkerDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateTaskPreference = (index: number, value: string): void => {
    setDraft((current) => {
      const taskPreferences = [...current.taskPreferences] as WorkerDraft["taskPreferences"];
      taskPreferences[index] = value;
      return { ...current, taskPreferences };
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!options) return;
    if (new Set(draft.taskPreferences).size !== 3) {
      setError("Choose three distinct task preferences.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await apiJson<{ registrationId: string }>(
        "/api/public/registration/worker",
        {
          method: "POST",
          body: JSON.stringify({
            ...draft,
            submissionKey,
            dateOfBirth: draft.dateOfBirth || null,
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
        setError("Worker registration is no longer open.");
      } else if (body?.fields?.[0]?.message) {
        setError(body.fields[0].message);
      } else {
        setError("We could not save this worker registration. Review the form and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (optionsError) {
    return <p role="alert">The worker form options could not be loaded. Please try again shortly.</p>;
  }
  if (!options) return <p aria-busy="true">Loading worker registration form...</p>;
  if (registrationId) {
    return (
      <WorkerRegistrationConfirmation
        registrationId={registrationId}
        guidance={options.confirmationGuidance}
      />
    );
  }

  const rankLabels = ["First choice", "Second choice", "Third choice"];

  return (
    <form className="worker-registration-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="registration-fieldset">
        <legend>Worker information</legend>
        <div className="registration-grid registration-grid-three">
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              maxLength={320}
              value={draft.email}
              onChange={(event) => update("email", event.target.value)}
            />
          </label>
          <label>
            First name
            <input
              required
              autoComplete="given-name"
              maxLength={100}
              value={draft.firstName}
              onChange={(event) => update("firstName", event.target.value)}
            />
          </label>
          <label>
            Last name
            <input
              required
              autoComplete="family-name"
              maxLength={100}
              value={draft.lastName}
              onChange={(event) => update("lastName", event.target.value)}
            />
          </label>
          <label>
            Date of birth (optional)
            <input
              type="date"
              autoComplete="bday"
              max={new Date().toISOString().slice(0, 10)}
              value={draft.dateOfBirth}
              onChange={(event) => update("dateOfBirth", event.target.value)}
            />
          </label>
          <label>
            Gender
            <select
              required
              value={draft.gender}
              onChange={(event) => update("gender", event.target.value as WorkerDraft["gender"])}
            >
              <option value="">Select one</option>
              {options.genders.map((gender) => (
                <option key={gender} value={gender}>{gender === "male" ? "Male" : "Female"}</option>
              ))}
            </select>
          </label>
          <label>
            Cell number (digits only)
            <input
              required
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              minLength={10}
              maxLength={15}
              value={draft.cellPhone}
              onChange={(event) => update("cellPhone", digitsOnly(event.target.value))}
            />
          </label>
          <label>
            Alternate number (optional)
            <input
              type="tel"
              inputMode="numeric"
              minLength={10}
              maxLength={15}
              value={draft.altPhone}
              onChange={(event) => update("altPhone", digitsOnly(event.target.value))}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Mailing address</legend>
        <div className="registration-grid">
          <label className="span-two">
            Street address
            <input
              required
              autoComplete="street-address"
              maxLength={200}
              value={draft.streetAddress}
              onChange={(event) => update("streetAddress", event.target.value)}
            />
          </label>
          <label>
            City
            <input
              required
              autoComplete="address-level2"
              maxLength={100}
              value={draft.city}
              onChange={(event) => update("city", event.target.value)}
            />
          </label>
          <label>
            State or province
            <select
              required
              autoComplete="address-level1"
              value={draft.stateOrProvince}
              onChange={(event) => update("stateOrProvince", event.target.value)}
            >
              <option value="">Select one</option>
              {options.stateOrProvinceOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Zip or postal code
            <input
              required
              autoComplete="postal-code"
              maxLength={20}
              value={draft.postalCode}
              onChange={(event) => update("postalCode", event.target.value)}
            />
          </label>
          <label>
            Country
            <input
              required
              autoComplete="country-name"
              maxLength={100}
              value={draft.country}
              onChange={(event) => update("country", event.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Faith and church</legend>
        <label>
          How long have you been faithfully serving the Lord?
          <textarea
            required
            rows={5}
            maxLength={4000}
            value={draft.faithServingResponse}
            onChange={(event) => update("faithServingResponse", event.target.value)}
          />
        </label>
        <div className="registration-grid">
          <ChurchCombobox
            churchName={draft.churchName}
            pastorName={draft.pastorName}
            selectedChurchId={draft.selectedChurchId}
            onChange={(value) => setDraft((current) => ({ ...current, ...value }))}
          />
          <label>
            Pastor phone number (digits only)
            <input
              required
              type="tel"
              inputMode="numeric"
              minLength={10}
              maxLength={15}
              value={draft.pastorPhone}
              onChange={(event) => update("pastorPhone", digitsOnly(event.target.value))}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Preferred tasks</legend>
        <p className="registration-guidance">{options.taskGuidance}</p>
        <div className="registration-grid registration-grid-three">
          {draft.taskPreferences.map((preference, rank) => (
            <label key={rank}>
              {rankLabels[rank]}
              <select
                required
                value={preference}
                onChange={(event) => updateTaskPreference(rank, event.target.value)}
              >
                <option value="">Select one</option>
                {options.taskOptions.map((task) => (
                  <option
                    key={task}
                    value={task}
                    disabled={draft.taskPreferences.some(
                      (selected, selectedRank) => selectedRank !== rank && selected === task,
                    )}
                  >
                    {task}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="registration-fieldset">
        <legend>Worker T-shirt</legend>
        <p className="registration-guidance">{options.tShirtGuidance}</p>
        <label>
          Size (optional)
          <select
            value={draft.tShirtSize}
            onChange={(event) => update("tShirtSize", event.target.value)}
          >
            <option value="">No selection</option>
            {options.tShirtSizes.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </fieldset>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="registration-actions">
        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit worker registration"}
        </button>
      </div>
    </form>
  );
}
