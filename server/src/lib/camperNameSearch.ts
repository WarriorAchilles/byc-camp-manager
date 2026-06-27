import type { Prisma } from "@prisma/client";

export function nameSearchTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Name search for campers in a camp year (archived excluded). */
export function camperWhereForNameTokens(
  campYearId: string,
  tokens: string[],
): Prisma.CamperWhereInput {
  return nameWhereForTokens<Prisma.CamperWhereInput>(campYearId, tokens);
}

/** Name search for workers in a camp year (archived excluded). */
export function workerWhereForNameTokens(
  campYearId: string,
  tokens: string[],
): Prisma.WorkerWhereInput {
  return nameWhereForTokens<Prisma.WorkerWhereInput>(campYearId, tokens);
}

/** Name search for dorm leaders in a camp year (archived excluded). */
export function dormLeaderWhereForNameTokens(
  campYearId: string,
  tokens: string[],
): Prisma.DormLeaderWhereInput {
  return nameWhereForTokens<Prisma.DormLeaderWhereInput>(campYearId, tokens);
}

function nameWhereForTokens<
  T extends
    | Prisma.CamperWhereInput
    | Prisma.WorkerWhereInput
    | Prisma.DormLeaderWhereInput,
>(campYearId: string, tokens: string[]): T {
  let where = { campYearId, archivedAt: null } as T;
  if (tokens.length >= 2) {
    const [a, b] = [tokens[0], tokens[1]];
    where = {
      ...where,
      AND: [
        {
          OR: [
            { firstName: { contains: a, mode: "insensitive" } },
            { lastName: { contains: a, mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { firstName: { contains: b, mode: "insensitive" } },
            { lastName: { contains: b, mode: "insensitive" } },
          ],
        },
      ],
    } as T;
  } else {
    const t = tokens[0];
    where = {
      ...where,
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
      ],
    } as T;
  }
  return where;
}
