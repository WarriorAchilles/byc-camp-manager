import { describe, expect, it } from "vitest";
import { signAuthToken, verifyAuthToken } from "./lib/authToken.js";
import { hashPassword, verifyPassword } from "./lib/password.js";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("my-secure-password-12");
    await expect(verifyPassword("my-secure-password-12", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("my-secure-password-12");
    await expect(verifyPassword("wrong-password-here", hash)).resolves.toBe(
      false,
    );
  });
});

describe("auth JWT", () => {
  it("round-trips payload", () => {
    const token = signAuthToken({
      sub: "user-id-1",
      role: "camp_admin",
    });
    const decoded = verifyAuthToken(token);
    expect(decoded.sub).toBe("user-id-1");
    expect(decoded.role).toBe("camp_admin");
  });
});
