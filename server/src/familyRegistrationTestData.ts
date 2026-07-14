import {
  MEDICAL_AGREEMENT_VERSION,
  type FamilySubmission,
} from "./lib/familyRegistration.js";

export function validFamilySubmission(): FamilySubmission {
  return {
    submissionKey: "e3ae65c2-ffbe-42d3-89fb-59ccd022d917",
    guardian: {
      fullName: "Jamie Guardian",
      email: "jamie@example.test",
      phone: "5551234567",
      relationship: "Parent",
      address: {
        streetAddress: "100 Camp Road",
        city: "Murrayville",
        stateOrProvince: "GA",
        postalCode: "30564",
        country: "United States",
      },
    },
    campers: [{
      firstName: "Taylor",
      lastName: "Camper",
      middleName: null,
      dateOfBirth: "2012-05-04",
      gender: "female",
      useFamilyAddress: true,
      address: null,
      camperCellPhone: null,
      guardianName: "Jamie Guardian",
      guardianPhone: "5551234567",
      identifiesAsChristian: true,
      receivedHolyGhost: true,
      churchName: "Example Tabernacle",
      pastorName: "Pat Pastor",
      tShirtIntent: "Adult S",
      medicalNotes: "None",
      allergies: "None",
      medications: "None",
      dietaryRestrictions: "None",
      emergencyContactName: "Casey Contact",
      emergencyContactPhone: "5557654321",
      specialNeeds: "None",
    }],
    legal: {
      typedName: "Jamie Guardian",
      acknowledged: true,
      agreementVersion: MEDICAL_AGREEMENT_VERSION,
    },
  };
}

