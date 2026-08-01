export type RegistrationType = "self" | "family";

export function registrationProgressLabels(
  registrationType: RegistrationType,
  hasMerchandise: boolean,
  medicalConsentRequired: boolean,
): string[] {
  const labels = registrationType === "self"
    ? ["Your contact information", "Camper information"]
    : ["Parent or guardian", "Campers"];

  return [
    ...labels,
    ...(medicalConsentRequired ? ["Medical authorization"] : []),
    ...(hasMerchandise ? ["Merchandise"] : []),
    "Payment",
  ];
}
