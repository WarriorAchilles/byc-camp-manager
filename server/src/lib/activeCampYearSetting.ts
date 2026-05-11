import type { PrismaClient } from "@prisma/client";

const SETTINGS_ROW_ID = "default" as const;

/** Resolves the staff default camp year id, or null if unset or the row points at a missing year. */
export async function getActiveCampYearId(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.appSettings.findUnique({
    where: { id: SETTINGS_ROW_ID },
    select: { activeCampYearId: true },
  });
  if (!row?.activeCampYearId) {
    return null;
  }
  const exists = await prisma.campYear.findUnique({
    where: { id: row.activeCampYearId },
    select: { id: true },
  });
  return exists ? row.activeCampYearId : null;
}

export { SETTINGS_ROW_ID };
