import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

const TOKEN_BYTES = 16;

type DbClient = PrismaClient | Prisma.TransactionClient;

export function newQrToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** Allocates a globally unique camper QR token (bounded retries for collision). */
export async function allocateUniqueCamperQrToken(prisma: DbClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = newQrToken();
    const clash = await prisma.camper.findUnique({
      where: { qrToken: candidate },
      select: { id: true },
    });
    if (!clash) {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique QR token");
}

const HEX32 = /^[a-f0-9]{32}$/i;

/** Accepts raw hex token or common URL shapes embedding the 32-char hex token. */
export function parseCamperQrTokenFromScan(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (HEX32.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    for (const key of ["token", "qr", "qrToken"]) {
      const fromQuery = url.searchParams.get(key);
      if (fromQuery && HEX32.test(fromQuery)) {
        return fromQuery.toLowerCase();
      }
    }
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (lastSegment && HEX32.test(lastSegment)) {
      return lastSegment.toLowerCase();
    }
  } catch {
    /* not a URL */
  }
  return null;
}
