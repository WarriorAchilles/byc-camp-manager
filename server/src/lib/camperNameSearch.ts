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
  let where: Prisma.CamperWhereInput = { campYearId, archivedAt: null };
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
    };
  } else {
    const t = tokens[0];
    where = {
      ...where,
      OR: [
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
      ],
    };
  }
  return where;
}
