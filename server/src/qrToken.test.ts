import { describe, expect, it } from "vitest";
import { parseSelfCheckInTokenParam } from "./lib/qrToken.js";

describe("parseSelfCheckInTokenParam", () => {
  const sample = `${"fa".repeat(15)}fb`;

  it("accepts lowercase 32-char hex", () => {
    expect(parseSelfCheckInTokenParam(sample)).toBe(sample);
  });

  it("normalizes hex case", () => {
    expect(parseSelfCheckInTokenParam(sample.toUpperCase())).toBe(sample.toLowerCase());
  });

  it("rejects short or non-hex segments", () => {
    expect(parseSelfCheckInTokenParam("not-hex")).toBeNull();
    expect(parseSelfCheckInTokenParam("abc")).toBeNull();
  });
});
