import { describe, expect, it } from "vitest";
import { hasExpectedImageSignature, isCamperPhotoContentType } from "./camperPhoto.js";

describe("camper photo validation", () => {
  it("accepts supported image types and their real file signatures", () => {
    expect(isCamperPhotoContentType("image/jpeg")).toBe(true);
    expect(isCamperPhotoContentType("image/svg+xml")).toBe(false);
    expect(hasExpectedImageSignature(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      "image/jpeg",
    )).toBe(true);
    expect(hasExpectedImageSignature(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
    )).toBe(true);
    expect(hasExpectedImageSignature(
      new TextEncoder().encode("RIFF0000WEBP"),
      "image/webp",
    )).toBe(true);
  });

  it("rejects a declared image type when the bytes do not match", () => {
    expect(hasExpectedImageSignature(
      new TextEncoder().encode("<script>alert(1)</script>"),
      "image/jpeg",
    )).toBe(false);
  });
});
