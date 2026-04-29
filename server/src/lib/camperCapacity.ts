/**
 * Camp-wide camper capacity applies to online registration (hard block in a later phase).
 * Admin entry and CSV import warn first; callers pass confirmCapacityOverride to proceed past the cap.
 */

export type CapacityExceededBody = {
  error: "capacity_exceeded";
  message: string;
  currentCamperCount: number;
  capacity: number;
  additionalCampers: number;
};

export type EvaluateCamperCapacityInput = {
  capacity: number | null;
  currentCount: number;
  additionalCampers: number;
  confirmCapacityOverride: boolean;
};

export function evaluateCamperCapacity(
  input: EvaluateCamperCapacityInput,
): { ok: true } | { ok: false; body: CapacityExceededBody } {
  const { capacity, currentCount, additionalCampers, confirmCapacityOverride } = input;
  if (capacity === null || capacity === undefined) {
    return { ok: true };
  }
  if (additionalCampers < 1) {
    return { ok: true };
  }
  const proposedTotal = currentCount + additionalCampers;
  if (proposedTotal <= capacity || confirmCapacityOverride) {
    return { ok: true };
  }
  return {
    ok: false,
    body: {
      error: "capacity_exceeded",
      message: `This action would raise camper headcount to ${proposedTotal}, above the configured capacity of ${capacity}. Confirm override to proceed.`,
      currentCamperCount: currentCount,
      capacity,
      additionalCampers,
    },
  };
}
