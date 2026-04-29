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
