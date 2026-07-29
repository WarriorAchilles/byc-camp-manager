import { useEffect, useRef, useState } from "react";
import { apiJson, apiUrl, type ApiHttpError } from "../api";
import {
  createAdditionalCamper,
  type Address,
  type CamperDraft,
} from "./familyRegistrationCamper";
import {
  registrationProgressLabels,
  type RegistrationType,
} from "./familyRegistrationProgress";
import { ChurchCombobox } from "./ChurchCombobox";
import { RegistrationHomeLink } from "./RegistrationHomeLink";

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
  merchandiseItems: MerchandiseItem[];
};

type MerchandiseItem = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  availableOptions: string[];
  ownership: "family" | "camper";
};

type MerchandiseSelectionDraft = { quantity: number; selectedOption: string };

type CamperPhotoDraft = {
  file: File;
  previewUrl: string;
  uploadId: string | null;
};

const CAMPER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const CAMPER_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ReceiptLine = {
  id?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  lineTotalCents: number;
  lineType: "registration" | "merchandise" | "discount";
};

export type RegistrationReceipt = {
  id?: string;
  state?: "pending_payment" | "confirmed" | "expired" | "cancelled";
  paymentMethod?: "stripe" | "cash" | null;
  paymentStatus?: "unpaid" | "paid_stripe" | "paid_cash";
  registrationSubtotalCents: number;
  merchandiseSubtotalCents: number;
  discountCents: number;
  totalDueCents: number;
  amountPaidCents?: number;
  lineItems?: ReceiptLine[];
  receiptLineItems?: ReceiptLine[];
};

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
  gender: "",
  useFamilyAddress: true,
  address: emptyAddress(),
  camperCellPhone: "",
  guardianName: "",
  guardianPhone: "",
  identifiesAsChristian: null,
  receivedHolyGhost: null,
  churchName: "",
  pastorName: "",
  selectedChurchId: null,
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

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function merchandiseSelectionKey(itemId: string, camperIndex: number | null): string {
  return `${itemId}:${camperIndex ?? "family"}`;
}

async function uploadCamperPhoto(file: File, submissionKey: string): Promise<string> {
  const response = await fetch(
    apiUrl(`/api/public/registration/family/photos?submission_key=${encodeURIComponent(submissionKey)}`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    },
  );
  const body = await response.json().catch(() => null) as { photoUploadId?: string } | null;
  if (!response.ok || !body?.photoUploadId) {
    throw new Error(response.status === 413 ? "photo_too_large" : "photo_upload_failed");
  }
  return body.photoUploadId;
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
  const [camperPhotos, setCamperPhotos] = useState<Array<CamperPhotoDraft | null>>([null]);
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submissionKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [merchandiseSelections, setMerchandiseSelections] = useState<Record<string, MerchandiseSelectionDraft>>({});
  const [receipt, setReceipt] = useState<RegistrationReceipt | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [redirectState, setRedirectState] = useState<"success" | "cancel" | null>(null);
  const photoPreviewUrls = useRef(new Set<string>());

  useEffect(() => {
    void apiJson<FormOptions>("/api/public/registration/family/form-options")
      .then((value) => { setOptions(value); setOptionsError(false); })
      .catch(() => setOptionsError(true));
  }, []);

  useEffect(() => () => {
    for (const previewUrl of photoPreviewUrls.current) {
      URL.revokeObjectURL(previewUrl);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnedRegistrationId = params.get("registration_id");
    const stripeState = params.get("stripe");
    if (!returnedRegistrationId || (stripeState !== "success" && stripeState !== "cancel")) return;
    setRegistrationId(returnedRegistrationId);
    setRedirectState(stripeState);
    const sessionId = params.get("session_id");
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    void apiJson<{ registration: RegistrationReceipt }>(
      `/api/public/registration/family/${returnedRegistrationId}${query}`,
    ).then((value) => setReceipt(value.registration)).catch(() => {
      setError("We could not refresh payment status. Keep your registration reference and try again shortly.");
    });
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

  const selectCamperPhoto = (index: number, file: File | undefined): void => {
    if (!file) return;
    setError("");
    if (!CAMPER_PHOTO_TYPES.has(file.type)) {
      setError("Camper photos must be JPEG, PNG, or WebP images.");
      return;
    }
    if (file.size > CAMPER_PHOTO_MAX_BYTES) {
      setError("Camper photos must be 5 MB or smaller.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    photoPreviewUrls.current.add(previewUrl);
    setCamperPhotos((current) => current.map((photo, camperIndex) => {
      if (camperIndex !== index) return photo;
      if (photo) {
        URL.revokeObjectURL(photo.previewUrl);
        photoPreviewUrls.current.delete(photo.previewUrl);
      }
      return { file, previewUrl, uploadId: null };
    }));
  };

  const removeCamperAt = (index: number): void => {
    const photo = camperPhotos[index];
    if (photo) {
      URL.revokeObjectURL(photo.previewUrl);
      photoPreviewUrls.current.delete(photo.previewUrl);
    }
    setCampers((current) => current.filter((_, camperIndex) => camperIndex !== index));
    setCamperPhotos((current) => current.filter((_, camperIndex) => camperIndex !== index));
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
      const photoUploadIds = await Promise.all(camperPhotos.map(async (photo) => {
        if (!photo) return null;
        return photo.uploadId ?? uploadCamperPhoto(photo.file, submissionKey);
      }));
      setCamperPhotos((current) => current.map((photo, index) =>
        photo && photoUploadIds[index]
          ? { ...photo, uploadId: photoUploadIds[index] }
          : photo));
      const selectedMerchandise = options.merchandiseItems.flatMap((item) => {
        const ownerIndexes = item.ownership === "family" ? [null] : campers.map((_, index) => index);
        return ownerIndexes.flatMap((camperIndex) => {
          const selection = merchandiseSelections[merchandiseSelectionKey(item.id, camperIndex)];
          if (!selection || selection.quantity <= 0) return [];
          return [{
            merchandiseItemId: item.id,
            selectedOption: selection.selectedOption || null,
            quantity: selection.quantity,
            camperIndex,
          }];
        });
      });
      const result = await apiJson<{ registrationId: string; receipt: RegistrationReceipt }>("/api/public/registration/family", {
        method: "POST",
        body: JSON.stringify({
          submissionKey,
          registrationType,
          guardian: registrationContact,
          campers: campers.map((camper, index) => ({
            ...camper,
            useFamilyAddress: registrationType === "self" ? true : camper.useFamilyAddress,
            address: registrationType === "self" || camper.useFamilyAddress ? null : camper.address,
            camperCellPhone: registrationType === "self"
              ? guardian.phone
              : camper.camperCellPhone || null,
            guardianName: registrationType === "self" ? selfName : camper.guardianName,
            guardianPhone: registrationType === "self" ? guardian.phone : camper.guardianPhone,
            photoUploadId: photoUploadIds[index],
          })),
          merchandiseSelections: selectedMerchandise,
          legal: {
            typedName,
            acknowledged,
            agreementVersion: agreement.version,
          },
        }),
      });
      setRegistrationId(result.registrationId);
      setReceipt(result.receipt);
      setStep(5);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "photo_too_large") {
        setError("A camper photo is larger than 5 MB. Choose a smaller image and try again.");
        return;
      }
      if (caught instanceof Error && caught.message === "photo_upload_failed") {
        setError("We could not upload a camper photo. Check the image and try again.");
        return;
      }
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

  const refreshReceipt = async (): Promise<void> => {
    if (!registrationId) return;
    const result = await apiJson<{ registration: RegistrationReceipt }>(
      `/api/public/registration/family/${registrationId}`,
    );
    setReceipt(result.registration);
  };

  const selectCash = async (): Promise<void> => {
    if (!registrationId) return;
    setPaymentBusy(true);
    setError("");
    try {
      const result = await apiJson<{ registration: RegistrationReceipt }>(
        `/api/public/registration/family/${registrationId}/pay-cash`,
        { method: "POST", body: "{}" },
      );
      setReceipt(result.registration);
    } catch {
      setError("We could not confirm cash payment selection. Please refresh payment status before trying again.");
      await refreshReceipt().catch(() => undefined);
    } finally {
      setPaymentBusy(false);
    }
  };

  const selectStripe = async (): Promise<void> => {
    if (!registrationId) return;
    setPaymentBusy(true);
    setError("");
    try {
      const result = await apiJson<{ url: string }>(
        `/api/public/registration/family/${registrationId}/stripe-checkout`,
        { method: "POST", body: "{}" },
      );
      window.location.assign(result.url);
    } catch {
      setError("Online checkout could not be started. No new payment was recorded.");
      setPaymentBusy(false);
    }
  };

  if (registrationId && receipt) {
    const confirmed = receipt.state === "confirmed";
    return (
      <div className="family-registration-form registration-payment" role="status">
        <h2>{confirmed ? "Registration confirmed" : "Review and choose payment"}</h2>
        {redirectState === "success" && receipt.paymentStatus !== "paid_stripe" ? <p className="registration-notice">Stripe returned you to registration. Payment confirmation is still processing; this page shows the latest server-confirmed status.</p> : null}
        {redirectState === "cancel" ? <p className="registration-notice">Online checkout was canceled. Your registration is saved, and no payment was recorded.</p> : null}
        <p><strong>Registration reference:</strong> {registrationId}</p>
        <ReceiptBreakdown receipt={receipt} />
        <aside className="registration-total-due" aria-label="Total amount due">
          <span>Total amount due</span><strong>{formatMoney(receipt.totalDueCents)}</strong>
        </aside>
        {receipt.paymentStatus === "paid_stripe" ? (
          <div className="registration-confirmation-message"><h3>Paid online</h3><p>Your Stripe payment was confirmed by the server. No payment is due at camp.</p></div>
        ) : receipt.paymentMethod === "cash" && confirmed ? (
          <CashConfirmation totalDueCents={receipt.totalDueCents} />
        ) : (
          <fieldset className="registration-fieldset payment-choice">
            <legend>Choose a payment method</legend>
            <button className="btn" type="button" disabled={paymentBusy} onClick={() => void selectStripe()}>Pay now securely with Stripe</button>
            <button className="btn secondary" type="button" disabled={paymentBusy} onClick={() => void selectCash()}>Confirm registration and pay cash at camp</button>
            <p className="registration-fine-print">Online payment is confirmed only after Stripe reports payment to the server. Choosing cash confirms registration while preserving the exact unpaid balance above.</p>
          </fieldset>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {confirmed ? <RegistrationHomeLink /> : null}
      </div>
    );
  }

  if (registrationId && !receipt) return <p aria-busy="true">Refreshing registration payment status…</p>;

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
  const hasMerchandise = options.merchandiseItems.length > 0;
  const progressLabels = registrationProgressLabels(registrationType, hasMerchandise);

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
              {campers.length > 1 ? <button className="btn secondary camper-remove" type="button" onClick={() => removeCamperAt(index)}>Remove camper</button> : null}
              <div className="registration-grid registration-grid-three">
                <label>Legal first name<input required value={camper.firstName} onChange={(event) => updateCamper(index, "firstName", event.target.value)} /></label>
                <label>Middle name or initial<input value={camper.middleName} onChange={(event) => updateCamper(index, "middleName", event.target.value)} /></label>
                <label>Last name<input required value={camper.lastName} onChange={(event) => updateCamper(index, "lastName", event.target.value)} /></label>
                <label>Date of birth<input required type="date" max={selfRegistration ? adultBirthDateMaximum() : new Date().toISOString().slice(0, 10)} value={camper.dateOfBirth} onChange={(event) => updateCamper(index, "dateOfBirth", event.target.value)} /></label>
                <label>Gender<select required value={camper.gender} onChange={(event) => updateCamper(index, "gender", event.target.value as CamperDraft["gender"])}><option value="">Select one</option>{options.genders.map((gender) => <option key={gender} value={gender}>{gender === "male" ? "Male" : "Female"}</option>)}</select></label>
                {!selfRegistration ? <label>Camper cell (optional, digits only)<input inputMode="numeric" minLength={10} maxLength={15} value={camper.camperCellPhone} onChange={(event) => updateCamper(index, "camperCellPhone", digitsOnly(event.target.value))} /></label> : null}
                {!selfRegistration ? <label>Parent/guardian name<input required value={camper.guardianName} onChange={(event) => updateCamper(index, "guardianName", event.target.value)} /></label> : null}
                {!selfRegistration ? <label>Parent/guardian phone<input required inputMode="numeric" minLength={10} maxLength={15} value={camper.guardianPhone} onChange={(event) => updateCamper(index, "guardianPhone", digitsOnly(event.target.value))} /></label> : null}
                <label>T-shirt size intent<select required value={camper.tShirtIntent} onChange={(event) => updateCamper(index, "tShirtIntent", event.target.value)}><option value="">Select one</option>{options.tShirtSizes.map((size) => <option key={size}>{size}</option>)}</select></label>
              </div>
              <div className="camper-photo-field">
                <div>
                  <strong>Camper photo (optional)</strong>
                  <p className="registration-fine-print">
                    Add a clear, recent picture so camp admins can recognize this camper. JPEG, PNG,
                    or WebP; 5 MB maximum.
                  </p>
                  <label className="camper-photo-picker">
                    Choose photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        selectCamperPhoto(index, event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                {camperPhotos[index] ? (
                  <div className="camper-photo-preview">
                    <img
                      src={camperPhotos[index]!.previewUrl}
                      alt={`Preview for ${camperLegalName(camper) || `camper ${index + 1}`}`}
                    />
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        const photo = camperPhotos[index];
                        if (photo) {
                          URL.revokeObjectURL(photo.previewUrl);
                          photoPreviewUrls.current.delete(photo.previewUrl);
                        }
                        setCamperPhotos((current) => current.map((entry, camperIndex) =>
                          camperIndex === index ? null : entry));
                      }}
                    >
                      Remove photo
                    </button>
                  </div>
                ) : null}
              </div>
              {selfRegistration
                ? <p className="registration-fine-print">Your contact mailing address will be used for this camper record.</p>
                : <label className="registration-checkbox"><input type="checkbox" checked={camper.useFamilyAddress} onChange={(event) => updateCamper(index, "useFamilyAddress", event.target.checked)} />Use the family mailing address</label>}
              {!selfRegistration && !camper.useFamilyAddress ? <AddressFields address={camper.address} options={options.stateOrProvinceOptions} onChange={(key, value) => updateCamperAddress(index, key, value)} /> : null}
              <div className="registration-grid">
                <YesNoField label="Does this camper identify as a Christian?" value={camper.identifiesAsChristian} onChange={(value) => updateCamper(index, "identifiesAsChristian", value)} />
                <YesNoField label="Received the gift of the Holy Ghost since believing?" value={camper.receivedHolyGhost} onChange={(value) => updateCamper(index, "receivedHolyGhost", value)} />
                <ChurchCombobox
                  churchName={camper.churchName}
                  pastorName={camper.pastorName}
                  selectedChurchId={camper.selectedChurchId ?? null}
                  onChange={(value) => setCampers((current) => current.map((entry, camperIndex) =>
                    camperIndex === index ? { ...entry, ...value } : entry))}
                />
                {index > 0 ? (
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      const previous = campers[index - 1]!;
                      setCampers((current) => current.map((entry, camperIndex) =>
                        camperIndex === index
                          ? {
                              ...entry,
                              churchName: previous.churchName,
                              pastorName: previous.pastorName,
                              selectedChurchId: previous.selectedChurchId ?? null,
                            }
                          : entry));
                    }}
                  >
                    Use the same church as the previous camper
                  </button>
                ) : null}
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
          {!selfRegistration ? <button className="btn secondary add-camper" type="button" onClick={() => {
            setCampers((current) => [...current, createAdditionalCamper(current[0]!)]);
            setCamperPhotos((current) => [...current, null]);
          }}>Add another camper</button> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setStep(1)}>Back</button><button className="btn" type="submit">Continue to authorization</button></div>
        </form>
      ) : null}

      {step === 3 ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (hasMerchandise) {
            setStep(4);
            window.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            void submit();
          }
        }}>
          <fieldset className="registration-fieldset">
            <legend>Emergency medical authorization</legend>
            <div className="agreement-copy"><p>{agreement.text}</p><p><strong>Covered camper(s):</strong> {campers.map((camper) => `${camper.firstName} ${camper.lastName}`).join(", ")}</p></div>
            <label className="registration-checkbox"><input required type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{agreement.acknowledgmentText}</label>
            <label>{selfRegistration ? "Type your first and last name exactly as entered for the camper" : "Type the parent or guardian full name exactly as entered in Step 1"}<input required autoComplete="name" value={typedName} onChange={(event) => setTypedName(event.target.value)} /></label>
            <p className="registration-fine-print">The accepted agreement text, typed name, date and time, and request IP address will be stored with this registration.</p>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setStep(2)}>Back</button><button className="btn" type="submit" disabled={submitting}>{hasMerchandise ? "Continue to merchandise" : submitting ? "Calculating and saving…" : "Review total and choose payment"}</button></div>
        </form>
      ) : null}

      {hasMerchandise && step === 4 ? (
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <fieldset className="registration-fieldset">
            <legend>Optional merchandise pre-order</legend>
            <div className="merchandise-grid">
              {options.merchandiseItems.flatMap((item) => {
                const ownerIndexes = item.ownership === "family" ? [null] : campers.map((_, index) => index);
                return ownerIndexes.map((camperIndex) => {
                  const key = merchandiseSelectionKey(item.id, camperIndex);
                  const selected = merchandiseSelections[key] ?? { quantity: 0, selectedOption: "" };
                  const ownerLabel = camperIndex === null ? "Family order" : camperLegalName(campers[camperIndex]!) || `Camper ${camperIndex + 1}`;
                  return <div className="merchandise-card" key={key}>
                    <h3>{item.name}</h3><p className="muted">{ownerLabel} · {formatMoney(item.priceCents)} each</p>
                    {item.description ? <p>{item.description}</p> : null}
                    {item.availableOptions.length > 0 ? <label>Option<select required={selected.quantity > 0} value={selected.selectedOption} onChange={(event) => setMerchandiseSelections((current) => ({ ...current, [key]: { ...selected, selectedOption: event.target.value } }))}><option value="">Select one</option>{item.availableOptions.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
                    <label>Quantity<input type="number" min="0" max="20" value={selected.quantity} onChange={(event) => setMerchandiseSelections((current) => ({ ...current, [key]: { ...selected, quantity: Number(event.target.value) } }))} /></label>
                  </div>;
                });
              })}
            </div>
          </fieldset>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="registration-actions"><button className="btn secondary" type="button" onClick={() => setStep(3)}>Back</button><button className="btn" type="submit" disabled={submitting}>{submitting ? "Calculating and saving…" : "Review total and choose payment"}</button></div>
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

function YesNoField({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void }): React.ReactElement {
  return <label>{label}<select required value={value === null ? "" : value ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "yes")}><option value="">Select one</option><option value="yes">Yes</option><option value="no">No</option></select></label>;
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.ReactElement {
  return <label>{label}<textarea rows={3} maxLength={4000} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function CashConfirmation({ totalDueCents }: { totalDueCents: number }): React.ReactElement {
  return <div className="registration-confirmation-message cash-due"><h3>Pay at camp with cash</h3><p>Registration is confirmed and remains unpaid.</p><p><strong>Bring exactly {formatMoney(totalDueCents)} to camp.</strong></p></div>;
}

export function ReceiptBreakdown({ receipt }: { receipt: RegistrationReceipt }): React.ReactElement {
  const lines = receipt.receiptLineItems ?? receipt.lineItems ?? [];
  return <section className="registration-receipt" aria-labelledby="registration-receipt-title">
    <h3 id="registration-receipt-title">Itemized receipt</h3>
    <div className="receipt-lines">
      {lines.map((line, index) => <div className={`receipt-line receipt-line-${line.lineType}`} key={line.id ?? `${line.description}-${index}`}>
        <span>{line.description}{line.quantity > 1 ? ` × ${line.quantity}` : ""}</span>
        <strong>{formatMoney(line.lineTotalCents)}</strong>
      </div>)}
    </div>
    <dl className="receipt-totals">
      <div><dt>Registration subtotal</dt><dd>{formatMoney(receipt.registrationSubtotalCents)}</dd></div>
      {receipt.discountCents > 0 ? <div className="receipt-discount"><dt>Multi-camper discounts</dt><dd>−{formatMoney(receipt.discountCents)}</dd></div> : null}
      <div><dt>Merchandise subtotal</dt><dd>{formatMoney(receipt.merchandiseSubtotalCents)}</dd></div>
      <div className="receipt-grand-total"><dt>Total</dt><dd>{formatMoney(receipt.totalDueCents)}</dd></div>
    </dl>
  </section>;
}
