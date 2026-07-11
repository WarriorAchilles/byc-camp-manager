import { describe, expect, it } from "vitest";
import { resolveBrowserSurface } from "./publicSurface";

describe("browser surface isolation", () => {
  it("uses the configured registration origin", () => {
    expect(resolveBrowserSurface({
      currentOrigin: "https://register.example.test",
      currentHostname: "register.example.test",
      registrationOrigin: "https://register.example.test",
    })).toBe("registration");
    expect(resolveBrowserSurface({
      currentOrigin: "https://admin.example.test",
      currentHostname: "admin.example.test",
      registrationOrigin: "https://register.example.test",
    })).toBe("admin");
  });

  it("falls back to the conventional registration subdomain for local builds", () => {
    expect(resolveBrowserSurface({
      currentOrigin: "http://registration.localhost:5173",
      currentHostname: "registration.localhost",
    })).toBe("registration");
  });
});
