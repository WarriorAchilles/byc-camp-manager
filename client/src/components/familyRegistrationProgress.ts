export type RegistrationType = "self" | "family";

export function registrationProgressLabels(
  registrationType: RegistrationType,
  hasMerchandise: boolean,
): string[] {
  const labels = registrationType === "self"
    ? ["Your contact information", "Camper information", "Medical authorization"]
    : ["Parent or guardian", "Campers", "Medical authorization"];

  return [...labels, ...(hasMerchandise ? ["Merchandise"] : []), "Payment"];
}
