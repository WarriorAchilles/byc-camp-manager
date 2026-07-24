import { describe, expect, it } from "vitest";
import { resolveRegistrationAvailability } from "./lib/registrationAvailability.js";

const now = new Date("2030-01-15T12:00:00.000Z");

describe("registration availability", () => {
  it("uses the opening time when the manual override is off", () => {
    expect(resolveRegistrationAvailability({ flow: "family", manuallyEnabled: false, opensAt: null, closesAt: null }, now)).toBe("not_configured");
    expect(resolveRegistrationAvailability({ flow: "family", manuallyEnabled: false, opensAt: new Date("2030-01-16T00:00:00Z"), closesAt: null }, now)).toBe("scheduled");
  });

  it("uses server time for open and closed scheduled states", () => {
    expect(resolveRegistrationAvailability({ flow: "worker", manuallyEnabled: false, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: null }, now)).toBe("open");
    expect(resolveRegistrationAvailability({ flow: "worker", manuallyEnabled: false, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: now }, now)).toBe("closed");
  });

  it("opens immediately when the manual override is on regardless of dates", () => {
    expect(resolveRegistrationAvailability({ flow: "worker", manuallyEnabled: true, opensAt: null, closesAt: null }, now)).toBe("open");
    expect(resolveRegistrationAvailability({ flow: "worker", manuallyEnabled: true, opensAt: new Date("2030-01-16T00:00:00Z"), closesAt: null }, now)).toBe("open");
    expect(resolveRegistrationAvailability({ flow: "worker", manuallyEnabled: true, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: now }, now)).toBe("open");
  });

  it("blocks family capacity without affecting workers or leaders", () => {
    const common = { manuallyEnabled: true, opensAt: new Date("2030-01-01T00:00:00Z"), closesAt: null, camperCapacity: 10, activeCamperCount: 10 };
    expect(resolveRegistrationAvailability({ ...common, flow: "family" }, now)).toBe("capacity_reached");
    expect(resolveRegistrationAvailability({ ...common, flow: "worker" }, now)).toBe("open");
    expect(resolveRegistrationAvailability({ ...common, flow: "leader" }, now)).toBe("open");
  });

  it("shows the scheduled countdown before capacity status", () => {
    expect(resolveRegistrationAvailability({
      flow: "family",
      manuallyEnabled: false,
      opensAt: new Date("2030-01-16T00:00:00Z"),
      closesAt: null,
      camperCapacity: 10,
      activeCamperCount: 10,
    }, now)).toBe("scheduled");
  });
});
