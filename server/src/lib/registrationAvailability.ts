export type RegistrationFlow = "family" | "worker" | "leader";
export type RegistrationAvailabilityState =
  | "not_configured"
  | "disabled"
  | "scheduled"
  | "open"
  | "closed"
  | "capacity_reached";

type AvailabilityInput = {
  flow: RegistrationFlow;
  manuallyEnabled: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  camperCapacity?: number | null;
  activeCamperCount?: number;
};

export function resolveRegistrationAvailability(
  input: AvailabilityInput,
  now: Date,
): RegistrationAvailabilityState {
  const capacityReached =
    input.flow === "family" &&
    input.camperCapacity !== null &&
    input.camperCapacity !== undefined &&
    (input.activeCamperCount ?? 0) >= input.camperCapacity;

  if (input.manuallyEnabled) {
    return capacityReached ? "capacity_reached" : "open";
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
  return capacityReached ? "capacity_reached" : "open";
}
