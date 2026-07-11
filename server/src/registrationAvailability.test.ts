import { describe, expect, it } from "vitest";
import { resolveRegistrationAvailability } from "./lib/registrationAvailability.js";

const now = new Date("2030-01-15T12:00:00.000Z");

describe("registration availability", () => {
  it("requires the manual gate and an opening time", () => {
    expect(resolveRegistrationAvailability({ flow: "family", enabled: false, opensAt: now, closesAt: null }, now)).toBe("disabled");
    expect(resolveRegistrationAvailability({ flow: "family", enabled: true, opensAt: null, closesAt: null }, now)).toBe("not_configured");
  });

  it("uses server time for scheduled, open, and closed states", () => {
    expect(resolveRegistrationAvailability({ flow: "worker", enabled: true, opensAt: new Date("2030-01-16T00:00:00Z"), closesAt: null }, now)).toBe("scheduled");
    expect(resolveRegistrationAvailability({ flow: "worker", enabled: true, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: null }, now)).toBe("open");
    expect(resolveRegistrationAvailability({ flow: "worker", enabled: true, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: now }, now)).toBe("closed");
  });

  it("blocks family capacity without affecting workers", () => {
    const common = { enabled: true, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: null, camperCapacity: 10, activeCamperCount: 10 };
    expect(resolveRegistrationAvailability({ ...common, flow: "family" }, now)).toBe("capacity_reached");
    expect(resolveRegistrationAvailability({ ...common, flow: "worker" }, now)).toBe("open");
  });
});
