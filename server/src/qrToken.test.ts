import { describe, expect, it } from "vitest";
import { parseCamperQrTokenFromScan } from "./lib/qrToken.js";

describe("parseCamperQrTokenFromScan", () => {
  const sample = "a".repeat(32);

  it("accepts raw 32-char hex", () => {
    expect(parseCamperQrTokenFromScan(sample)).toBe(sample);
    expect(parseCamperQrTokenFromScan(sample.toUpperCase())).toBe(sample);
  });

  it("extracts token from URL query", () => {
    expect(parseCamperQrTokenFromScan(`https://camp.example/check-in?token=${sample}`)).toBe(sample);
  });

  it("extracts token from URL path segment", () => {
    expect(parseCamperQrTokenFromScan(`https://camp.example/c/${sample}`)).toBe(sample);
  });

  it("returns null for garbage", () => {
    expect(parseCamperQrTokenFromScan("not-a-token")).toBeNull();
    expect(parseCamperQrTokenFromScan("")).toBeNull();
  });
});
