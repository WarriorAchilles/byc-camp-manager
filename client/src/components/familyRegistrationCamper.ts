export type Address = {
  streetAddress: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
};

export type CamperDraft = {
  firstName: string;
  lastName: string;
  middleName: string;
  dateOfBirth: string;
  gender: "" | "male" | "female";
  useFamilyAddress: boolean;
  address: Address;
  camperCellPhone: string;
  guardianName: string;
  guardianPhone: string;
  identifiesAsChristian: boolean | null;
  receivedHolyGhost: boolean | null;
  churchName: string;
  pastorName: string;
  selectedChurchId?: string | null;
  tShirtIntent: string;
  medicalNotes: string;
  allergies: string;
  medications: string;
  dietaryRestrictions: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  specialNeeds: string;
};

export function camperRequiresMedicalConsent(dateOfBirth: string, campStartDate: Date): boolean {
  if (!dateOfBirth) return false;
  const adultCutoff = new Date(Date.UTC(
    campStartDate.getUTCFullYear() - 18,
    campStartDate.getUTCMonth(),
    campStartDate.getUTCDate(),
  )).toISOString().slice(0, 10);
  return dateOfBirth > adultCutoff;
}

export function createAdditionalCamper(firstCamper: CamperDraft): CamperDraft {
  return {
    ...firstCamper,
    address: { ...firstCamper.address },
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "",
    camperCellPhone: "",
    tShirtIntent: "",
    identifiesAsChristian: null,
    receivedHolyGhost: null,
    medicalNotes: "",
    allergies: "",
    medications: "",
    dietaryRestrictions: "",
    specialNeeds: "",
  };
}
