import { z } from "zod";

const adminUsernamePattern = /^[a-z0-9][a-z0-9._@+-]{0,99}$/;

export function canonicalizeAdminUsername(rawUsername: string | undefined): string | null {
  const username = rawUsername?.trim().toLowerCase();
  if (!username || !adminUsernamePattern.test(username)) {
    return null;
  }
  return username;
}

export const adminUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((username) => username.toLowerCase())
  .refine((username) => adminUsernamePattern.test(username), {
    message: "Invalid username",
  });
