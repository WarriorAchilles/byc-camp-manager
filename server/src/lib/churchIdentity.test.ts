import { describe, expect, it } from "vitest";
import {
  CHURCH_NORMALIZATION_VERSION,
  normalizeChurchName,
  normalizedChurchPair,
  normalizePastorName,
  similarity,
} from "./churchIdentity.js";

describe("church identity normalization v1", () => {
  it("has an explicit version", () => {
    expect(CHURCH_NORMALIZATION_VERSION).toBe(1);
  });

  it("normalizes Unicode, case, whitespace, and insignificant punctuation", () => {
    expect(normalizeChurchName("  FIRST—BAPTIST,  Church  ")).toBe("first baptist church");
    expect(normalizeChurchName("St. Paul’s")).toBe("st pauls");
    expect(normalizeChurchName("Ｆｉｒｓｔ Church")).toBe("first church");
  });

  it.each([
    ["Pastor Jane Doe", "jane doe"],
    ["Rev. Jane Doe", "jane doe"],
    ["Reverend Jane Doe", "jane doe"],
    ["Brother Jane Doe", "jane doe"],
    ["Bro. Jane Doe", "jane doe"],
  ])("normalizes supported pastor honorific %s", (input, expected) => {
    expect(normalizePastorName(input)).toBe(expected);
  });

  it("does not remove substantive words", () => {
    expect(normalizePastorName("Bishop Jane Doe")).toBe("bishop jane doe");
  });

  it("does not manufacture incomplete identities", () => {
    expect(normalizedChurchPair({ churchName: "First Church", pastorName: "" })).toBeNull();
    expect(normalizedChurchPair({ churchName: null, pastorName: "Jane Doe" })).toBeNull();
  });

  it("offers a bounded similarity signal without making an identity decision", () => {
    expect(similarity("first baptist", "frist baptist")).toBeGreaterThan(0.75);
    expect(similarity("first baptist", "unrelated")).toBeLessThan(0.5);
  });
});
