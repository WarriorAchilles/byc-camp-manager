export type RegistrationFlow = "family" | "worker";
export type RegistrationAvailabilityState =
  | "not_configured"
  | "disabled"
  | "scheduled"
  | "open"
  | "closed"
  | "capacity_reached";

type AvailabilityInput = {
  flow: RegistrationFlow;
  enabled: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  camperCapacity?: number | null;
  activeCamperCount?: number;
};

export function resolveRegistrationAvailability(
  input: AvailabilityInput,
  now: Date,
): RegistrationAvailabilityState {
  if (!input.enabled) {
    return "disabled";
  }
  if (!input.opensAt) {
    return "not_configured";
  }
  if (now < input.opensAt) {
    return "scheduled";
  }
  if (input.closesAt && now >= input.closesAt) {
    return "closed";
  }
  if (
    input.flow === "family" &&
    input.camperCapacity !== null &&
    input.camperCapacity !== undefined &&
    (input.activeCamperCount ?? 0) >= input.camperCapacity
  ) {
    return "capacity_reached";
  }
  return "open";
}
