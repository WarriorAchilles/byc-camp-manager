import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

const TOKEN_BYTES = 16;

type DbClient = PrismaClient | Prisma.TransactionClient;

export function newQrToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** Allocates a unique token for the posted camp-year self-check-in URL. */
export async function allocateUniqueCampYearSelfCheckInToken(prisma: DbClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = newQrToken();
    const clash = await prisma.campYear.findUnique({
      where: { selfCheckInToken: candidate },
      select: { id: true },
    });
    if (!clash) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique self check-in token");
}

const HEX32 = /^[a-f0-9]{32}$/i;

/** Validates the posted kiosk URL's `:token` path segment. */
export function parseSelfCheckInTokenParam(raw: string): string | null {
  const trimmed = raw.trim();
  if (!HEX32.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}
