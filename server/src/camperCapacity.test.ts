import { describe, expect, it } from "vitest";
import { evaluateCamperCapacity } from "./lib/camperCapacity.js";

describe("evaluateCamperCapacity", () => {
  it("allows additions when capacity is not configured", () => {
    expect(
      evaluateCamperCapacity({
        capacity: null,
        currentCount: 999,
        additionalCampers: 50,
        confirmCapacityOverride: false,
      }),
    ).toEqual({ ok: true });
  });

  it("blocks when over capacity without override", () => {
    const result = evaluateCamperCapacity({
      capacity: 100,
      currentCount: 100,
      additionalCampers: 1,
      confirmCapacityOverride: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.error).toBe("capacity_exceeded");
      expect(result.body.capacity).toBe(100);
      expect(result.body.additionalCampers).toBe(1);
    }
  });

  it("allows when override is confirmed", () => {
    expect(
      evaluateCamperCapacity({
        capacity: 100,
        currentCount: 100,
        additionalCampers: 1,
        confirmCapacityOverride: true,
      }),
    ).toEqual({ ok: true });
  });

  it("allows bulk additions within capacity without override", () => {
    expect(
      evaluateCamperCapacity({
        capacity: 120,
        currentCount: 100,
        additionalCampers: 20,
        confirmCapacityOverride: false,
      }),
    ).toEqual({ ok: true });
  });

  it("warns on bulk import when additional count exceeds remainder", () => {
    const result = evaluateCamperCapacity({
      capacity: 120,
      currentCount: 110,
      additionalCampers: 15,
      confirmCapacityOverride: false,
    });
    expect(result.ok).toBe(false);
  });
});
