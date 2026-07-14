import { useEffect, useState } from "react";
import { apiJson, type ApiHttpError } from "../api";

type Address = {
  streetAddress: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
};

type CamperDraft = {
  firstName: string;
  lastName: string;
  middleName: string;
  dateOfBirth: string;
  gender: "male" | "female";
  useFamilyAddress: boolean;
  address: Address;
  camperCellPhone: string;
  guardianName: string;
  guardianPhone: string;
  identifiesAsChristian: boolean;
  receivedHolyGhost: boolean;
  churchName: string;
  pastorName: string;
  tShirtIntent: string;
  medicalNotes: string;
  allergies: string;
  medications: string;
  dietaryRestrictions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  specialNeeds: string;
};

type FormOptions = {
  genders: string[];
  stateOrProvinceOptions: string[];
  tShirtSizes: string[];
  medicalAgreement: {
    version: string;
    text: string;
    acknowledgmentText: string;
    signatureMethod: "typed";
  };
  adultMedicalAgreement: {
    version: string;
    text: string;
    acknowledgmentText: string;
    signatureMethod: "typed";
  };
};

type RegistrationType = "self" | "family";

const emptyAddress = (): Address => ({
  streetAddress: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  country: "United States",
});

const emptyCamper = (): CamperDraft => ({
  firstName: "",
  lastName: "",
  middleName: "",
  dateOfBirth: "",
  gender: "male",
  useFamilyAddress: true,
  address: emptyAddress(),
  camperCellPhone: "",
  guardianName: "",
  guardianPhone: "",
  identifiesAsChristian: false,
  receivedHolyGhost: false,
  churchName: "",
  pastorName: "",
  tShirtIntent: "",
  medicalNotes: "",
  allergies: "",
  medications: "",
  dietaryRestrictions: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  specialNeeds: "",
});

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15);
}

function adultBirthDateMaximum(): string {
  const today = new Date();
  return new Date(Date.UTC(
    today.getUTCFullYear() - 18,
    today.getUTCMonth(),
    today.getUTCDate(),
  )).toISOString().slice(0, 10);
}

function camperLegalName(camper: CamperDraft): string {
  return `${camper.firstName} ${camper.lastName}`.trim();
}

export function FamilyRegistrationForm(): React.ReactElement {
  const [step, setStep] = useState(1);
  const [registrationType, setRegistrationType] = useState<RegistrationType | null>(null);
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [guardian, setGuardian] = useState({
    fullName: "",
    email: "",
    phone: "",
    relationship: "",
    address: emptyAddress(),
  });
  const [campers, setCampers] = useState<CamperDraft[]>([emptyCamper()]);
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [registrationId, setRegistrationId] = useState("");

  useEffect(() => {
    void apiJson<FormOptions>("/api/public/registration/family/form-options")
      .then((value) => { setOptions(value); setOptionsError(false); })
      .catch(() => setOptionsError(true));
  }, []);

  const updateCamper = <K extends keyof CamperDraft>(index: number, key: K, value: CamperDraft[K]): void => {
    setCampers((current) => current.map((camper, camperIndex) =>
      camperIndex === index ? { ...camper, [key]: value } : camper));
  };

  const updateCamperAddress = (index: number, key: keyof Address, value: string): void => {
    setCampers((current) => current.map((camper, camperIndex) =>
      camperIndex === index
        ? { ...camper, address: { ...camper.address, [key]: value } }
        : camper));
  };

  const continueFromContact = (): void => {
    setCampers((current) => current.map((camper) => ({
      ...camper,
      guardianName: registrationType === "self" ? "" : camper.guardianName || guardian.fullName,
      guardianPhone: registrationType === "self" ? guardian.phone : camper.guardianPhone || guardian.phone,
    })));
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (): Promise<void> => {
    if (!options || !registrationType) return;
    const selfName = camperLegalName(campers[0]!);
    const registrationContact = registrationType === "self"
      ? { ...guardian, fullName: selfName, relationship: "Self" }
      : guardian;
    const agreement = registrationType === "self"
      ? options.adultMedicalAgreement
      : options.medicalAgreement;
    setSubmitting(true);
    setError("");
    try {
      const result = await apiJson<{ registrationId: string }>("/api/public/registration/family", {
        method: "POST",
        body: JSON.stringify({
          submissionKey,
          registrationType,
          guardian: registrationContact,
          campers: campers.map((camper) => ({
            ...camper,
            useFamilyAddress: registrationType === "self" ? true : camper.useFamilyAddress,
            address: registrationType === "self" || camper.useFamilyAddress ? null : camper.address,
            camperCellPhone: camper.camperCellPhone || null,
            guardianName: registrationType === "self" ? selfName : camper.guardianName,
            guardianPhone: registrationType === "self" ? guardian.phone : camper.guardianPhone,
          })),
          legal: {
            typedName,
            acknowledged,
            agreementVersion: agreement.version,
          },
        }),
      });
      setRegistrationId(result.registrationId);
    } catch (caught) {
      const apiError = caught as ApiHttpError;
      const body = apiError.body as { error?: string; fields?: Array<{ message: string }> } | null;
      if (body?.error === "capacity_reached") setError("Camper capacity was reached before this registration could be saved.");
      else if (body?.error === "registration_closed") setError("Registration is no longer open.");
      else if (body?.fields?.[0]?.message) setError(body.fields[0].message);
      else setError("We could not save this registration. Please review the form and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (registrationId) {
    return (
      <div className="registration-success" role="status">
        <h2>{registrationType === "self" ? "Registration information saved" : "Family information saved"}</h2>
        <p>{registrationType === "self"
          ? "Your camper information and signed medical authorization were saved together."
          : "Your campers and signed medical authorization were saved together."}</p>
        <p><strong>Registration reference:</strong> {registrationId}</p>
        <p>This registration is awaiting the pricing, merchandise, and payment step.</p>
      </div>
    );
  }

  if (optionsError) return <p role="alert">The registration form options could not be loaded. Please try again shortly.</p>;
  if (!options) return <p aria-busy="true">Loading registration form…</p>;

  if (!registrationType) {
    return (
      <div className="family-registration-form registration-type-screen">
        <fieldset className="registration-fieldset registration-type-fieldset">
          <legend>Who are you registering?</legend>
          <p className="registration-type-intro">Choose the option that describes this registration.</p>
          <div className="registration-type-options">
            <button className="registration-type-option" type="button" onClick={() => setRegistrationType("self")}>
              <strong>I am 18 or older and registering myself</strong>
              <span>Use your own contact information and complete an adult medical authorization.</span>
            </button>
            <button className="registration-type-option" type="button" onClick={() => setRegistrationType("family")}>
              <strong>The camper is under 18, or I am a parent/guardian</strong>
              <span>A parent or legal guardian completes this flow for one or more campers.</span>
            </button>
          </div>
        </fieldset>
      </div>
    );
  }

  const selfRegistration = registrationType === "self";
  const agreement = selfRegistration ? options.adultMedicalAgreement : options.medicalAgreement;
  const progressLabels = selfRegistration
    ? ["Your contact information", "Camper information", "Medical authorization"]
    : ["Parent or guardian", "Campers", "Medical authorization"];

  return (
    <div className="family-registration-form">
      <ol className="registration-steps" aria-label="Registration progress">
        {progressLabels.map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <form onSubmit={(event) => { event.preventDefault(); continueFromContact(); }}>
          <fieldset className="registration-fieldset">
            <legend>{selfRegistration ? "Your contact information" : "Parent or guardian information"}</legend>
            <div className="registration-grid">
              {!selfRegistration ? <label>Full name<input required autoComplete="name" value={guardian.fullName} onChange={(event) => setGuardian({ ...guardian, fullName: event.target.value })} /></label> : null}
              <label>Email<input required type="email" autoComplete="email" value={guardian.email} onChange={(event) => setGuardian({ ...guardian, email: event.target.value })} /></label>
              <label>Phone (digits only)<input required inputMode="numeric" minLength={10} maxLength={15} value={guardian.phone} onChange={(event) => setGuardian({ ...guardian, phone: digitsOnly(event.target.value) })} /></label>
              {!selfRegistration ? <label>Relationship to camper(s)<input required value={guardian.relationship} onChange={(event) => setGuardian({ ...guardian, relationship: event.target.value })} /></label> : null}
            </div>
            <AddressFields address={guardian.address} options={options.stateOrProvinceOptions} onChange={(key, value) => setGuardian({ ...guardian, address: { ...guardian.address, [key]: value } })} />
          </fieldset>
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setRegistrationType(null)}>Back</button><button className="btn" type="submit">Continue to camper information</button></div>
        </form>
      ) : null}

      {step === 2 ? (
        <form onSubmit={(event) => { event.preventDefault(); setStep(3); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          {campers.map((camper, index) => (
            <fieldset className="registration-fieldset camper-entry" key={index}>
              <legend>{selfRegistration ? "Your camper information" : `Camper ${index + 1}`}</legend>
              {campers.length > 1 ? <button className="btn secondary camper-remove" type="button" onClick={() => setCampers((current) => current.filter((_, camperIndex) => camperIndex !== index))}>Remove camper</button> : null}
              <div className="registration-grid registration-grid-three">
                <label>Legal first name<input required value={camper.firstName} onChange={(event) => updateCamper(index, "firstName", event.target.value)} /></label>
                <label>Middle name or initial<input value={camper.middleName} onChange={(event) => updateCamper(index, "middleName", event.target.value)} /></label>
                <label>Last name<input required value={camper.lastName} onChange={(event) => updateCamper(index, "lastName", event.target.value)} /></label>
                <label>Date of birth<input required type="date" max={selfRegistration ? adultBirthDateMaximum() : new Date().toISOString().slice(0, 10)} value={camper.dateOfBirth} onChange={(event) => updateCamper(index, "dateOfBirth", event.target.value)} /></label>
                <label>Gender<select required value={camper.gender} onChange={(event) => updateCamper(index, "gender", event.target.value as CamperDraft["gender"])}>{options.genders.map((gender) => <option key={gender} value={gender}>{gender === "male" ? "Male" : "Female"}</option>)}</select></label>
                <label>Camper cell (optional, digits only)<input inputMode="numeric" minLength={10} maxLength={15} value={camper.camperCellPhone} onChange={(event) => updateCamper(index, "camperCellPhone", digitsOnly(event.target.value))} /></label>
                {!selfRegistration ? <label>Parent/guardian name<input required value={camper.guardianName} onChange={(event) => updateCamper(index, "guardianName", event.target.value)} /></label> : null}
                {!selfRegistration ? <label>Parent/guardian phone<input required inputMode="numeric" minLength={10} maxLength={15} value={camper.guardianPhone} onChange={(event) => updateCamper(index, "guardianPhone", digitsOnly(event.target.value))} /></label> : null}
                <label>T-shirt size intent<select required value={camper.tShirtIntent} onChange={(event) => updateCamper(index, "tShirtIntent", event.target.value)}><option value="">Select one</option>{options.tShirtSizes.map((size) => <option key={size}>{size}</option>)}</select></label>
              </div>
              {selfRegistration
                ? <p className="registration-fine-print">Your contact mailing address will be used for this camper record.</p>
                : <label className="registration-checkbox"><input type="checkbox" checked={camper.useFamilyAddress} onChange={(event) => updateCamper(index, "useFamilyAddress", event.target.checked)} />Use the family mailing address</label>}
              {!selfRegistration && !camper.useFamilyAddress ? <AddressFields address={camper.address} options={options.stateOrProvinceOptions} onChange={(key, value) => updateCamperAddress(index, key, value)} /> : null}
              <div className="registration-grid">
                <YesNoField label="Does this camper identify as a Christian?" value={camper.identifiesAsChristian} onChange={(value) => updateCamper(index, "identifiesAsChristian", value)} />
                <YesNoField label="Received the gift of the Holy Ghost since believing?" value={camper.receivedHolyGhost} onChange={(value) => updateCamper(index, "receivedHolyGhost", value)} />
                <label>Church presently attending<input required value={camper.churchName} onChange={(event) => updateCamper(index, "churchName", event.target.value)} /></label>
                <label>Pastor full name<input required value={camper.pastorName} onChange={(event) => updateCamper(index, "pastorName", event.target.value)} /></label>
                <label>Emergency contact name<input required value={camper.emergencyContactName} onChange={(event) => updateCamper(index, "emergencyContactName", event.target.value)} /></label>
                <label>Emergency contact phone<input required inputMode="numeric" minLength={10} maxLength={15} value={camper.emergencyContactPhone} onChange={(event) => updateCamper(index, "emergencyContactPhone", digitsOnly(event.target.value))} /></label>
              </div>
              <div className="registration-grid">
                <TextAreaField label="Medical notes or physical limitations" value={camper.medicalNotes} onChange={(value) => updateCamper(index, "medicalNotes", value)} />
                <TextAreaField label="Allergies" value={camper.allergies} onChange={(value) => updateCamper(index, "allergies", value)} />
                <TextAreaField label="Medications" value={camper.medications} onChange={(value) => updateCamper(index, "medications", value)} />
                <TextAreaField label="Dietary restrictions" value={camper.dietaryRestrictions} onChange={(value) => updateCamper(index, "dietaryRestrictions", value)} />
                <TextAreaField label="Special needs or accommodations" value={camper.specialNeeds} onChange={(value) => updateCamper(index, "specialNeeds", value)} />
              </div>
            </fieldset>
          ))}
          {!selfRegistration ? <button className="btn secondary add-camper" type="button" onClick={() => setCampers((current) => [...current, { ...emptyCamper(), guardianName: guardian.fullName, guardianPhone: guardian.phone }])}>Add another camper</button> : null}
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setStep(1)}>Back</button><button className="btn" type="submit">Continue to authorization</button></div>
        </form>
      ) : null}

      {step === 3 ? (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <fieldset className="registration-fieldset">
            <legend>Emergency medical authorization</legend>
            <div className="agreement-copy"><p>{agreement.text}</p><p><strong>Covered camper(s):</strong> {campers.map((camper) => `${camper.firstName} ${camper.lastName}`).join(", ")}</p></div>
            <label className="registration-checkbox"><input required type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{agreement.acknowledgmentText}</label>
            <label>{selfRegistration ? "Type your first and last name exactly as entered for the camper" : "Type the parent or guardian full name exactly as entered in Step 1"}<input required autoComplete="name" value={typedName} onChange={(event) => setTypedName(event.target.value)} /></label>
            <p className="registration-fine-print">The accepted agreement text, typed name, date and time, and request IP address will be stored with this registration.</p>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setStep(2)}>Back</button><button className="btn" type="submit" disabled={submitting}>{submitting ? "Saving…" : selfRegistration ? "Sign and save registration" : "Sign and save family"}</button></div>
        </form>
      ) : null}
    </div>
  );
}

function AddressFields({ address, options, onChange }: { address: Address; options: string[]; onChange: (key: keyof Address, value: string) => void }): React.ReactElement {
  return <div className="registration-grid address-grid">
    <label className="span-two">Street address<input required autoComplete="street-address" value={address.streetAddress} onChange={(event) => onChange("streetAddress", event.target.value)} /></label>
    <label>City<input required autoComplete="address-level2" value={address.city} onChange={(event) => onChange("city", event.target.value)} /></label>
    <label>State, province, or territory<select required autoComplete="address-level1" value={address.stateOrProvince} onChange={(event) => onChange("stateOrProvince", event.target.value)}><option value="">Select one</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>
    <label>ZIP or postal code<input required autoComplete="postal-code" value={address.postalCode} onChange={(event) => onChange("postalCode", event.target.value)} /></label>
    <label>Country<input required autoComplete="country-name" value={address.country} onChange={(event) => onChange("country", event.target.value)} /></label>
  </div>;
}

function YesNoField({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }): React.ReactElement {
  return <label>{label}<select value={value ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label>;
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.ReactElement {
  return <label>{label}<textarea rows={3} maxLength={4000} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
