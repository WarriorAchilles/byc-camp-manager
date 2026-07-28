import { Prisma } from "@prisma/client";

export const CHURCH_NORMALIZATION_VERSION = 1;

type ChurchClient = Pick<Prisma.TransactionClient, "church" | "churchAlias">;

export type ChurchIdentityPair = {
  churchName: string | null | undefined;
  pastorName: string | null | undefined;
};

export type ResolvedChurch = {
  id: string;
  name: string;
  pastorName: string;
  normalizedName: string;
  normalizedPastorName: string;
};

function normalizeBase(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US");
}

function removeInsignificantPunctuation(value: string): string {
  return value
    .replace(/[.,'"’]/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeChurchName(value: string): string {
  return removeInsignificantPunctuation(normalizeBase(value));
}

export function normalizePastorName(value: string): string {
  const withoutHonorific = normalizeBase(value).replace(
    /^(?:pastor|rev(?:erend)?|bro(?:ther)?)\.?\s+/u,
    "",
  );
  return removeInsignificantPunctuation(withoutHonorific);
}

export function normalizedChurchPair(pair: ChurchIdentityPair): {
  normalizedName: string;
  normalizedPastorName: string;
} | null {
  const churchName = pair.churchName?.trim() ?? "";
  const pastorName = pair.pastorName?.trim() ?? "";
  if (!churchName || !pastorName) return null;
  const normalizedName = normalizeChurchName(churchName);
  const normalizedPastorName = normalizePastorName(pastorName);
  if (!normalizedName || !normalizedPastorName) return null;
  return { normalizedName, normalizedPastorName };
}

export async function followChurchMerge(
  client: ChurchClient,
  churchId: string,
): Promise<ResolvedChurch | null> {
  const visited = new Set<string>();
  let id = churchId;
  while (!visited.has(id) && visited.size < 50) {
    visited.add(id);
    const church = await client.church.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        pastorName: true,
        normalizedName: true,
        normalizedPastorName: true,
        mergedIntoChurchId: true,
      },
    });
    if (!church) return null;
    if (!church.mergedIntoChurchId) return church;
    id = church.mergedIntoChurchId;
  }
  throw new Error("Church merge redirect cycle detected");
}

async function findExactChurch(
  client: ChurchClient,
  pair: { normalizedName: string; normalizedPastorName: string },
): Promise<ResolvedChurch | null> {
  const church = await client.church.findUnique({
    where: {
      normalizedName_normalizedPastorName: pair,
    },
    select: { id: true },
  });
  if (church) return followChurchMerge(client, church.id);

  const alias = await client.churchAlias.findUnique({
    where: {
      normalizedName_normalizedPastorName: pair,
    },
    select: { churchId: true },
  });
  return alias ? followChurchMerge(client, alias.churchId) : null;
}

async function selectedChurchMatchesPair(
  client: ChurchClient,
  selectedChurchId: string,
  pair: { normalizedName: string; normalizedPastorName: string },
): Promise<ResolvedChurch | null> {
  const selected = await client.church.findUnique({
    where: { id: selectedChurchId },
    select: {
      id: true,
      normalizedName: true,
      normalizedPastorName: true,
    },
  });
  if (!selected) return null;
  const survivor = await followChurchMerge(client, selected.id);
  if (!survivor) return null;
  const directPairs = [
    [selected.normalizedName, selected.normalizedPastorName],
    [survivor.normalizedName, survivor.normalizedPastorName],
  ];
  if (directPairs.some(([name, pastor]) =>
    name === pair.normalizedName && pastor === pair.normalizedPastorName
  )) {
    return survivor;
  }
  const alias = await client.churchAlias.findUnique({
    where: { normalizedName_normalizedPastorName: pair },
    select: { churchId: true },
  });
  if (!alias) return null;
  const aliasSurvivor = await followChurchMerge(client, alias.churchId);
  return aliasSurvivor?.id === survivor.id ? survivor : null;
}

export async function resolveChurchPair(
  client: ChurchClient,
  input: ChurchIdentityPair & {
    selectedChurchId?: string | null;
    createIfMissing: boolean;
  },
): Promise<ResolvedChurch | null> {
  const pair = normalizedChurchPair(input);
  if (!pair) return null;

  if (input.selectedChurchId) {
    const selected = await selectedChurchMatchesPair(client, input.selectedChurchId, pair);
    if (selected) return selected;
  }

  const existing = await findExactChurch(client, pair);
  if (existing || !input.createIfMissing) return existing;

  const churchName = input.churchName!.trim();
  const pastorName = input.pastorName!.trim();
  try {
    const created = await client.church.upsert({
      where: { normalizedName_normalizedPastorName: pair },
      create: {
        name: churchName,
        pastorName,
        ...pair,
      },
      update: {},
      select: {
        id: true,
        name: true,
        pastorName: true,
        normalizedName: true,
        normalizedPastorName: true,
      },
    });
    return followChurchMerge(client, created.id);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await findExactChurch(client, pair);
      if (raced) return raced;
    }
    throw error;
  }
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]!;
      const next = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, above, previous[rightIndex - 1]!) + 1;
      diagonal = above;
      previous[rightIndex] = next;
    }
  }
  return previous[right.length]!;
}

export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - editDistance(left, right) / longest;
}

export async function suggestChurches(
  client: ChurchClient,
  query: string,
  limit = 8,
): Promise<Array<{ id: string; churchName: string; pastorName: string }>> {
  const normalizedQuery = normalizeChurchName(query);
  if (normalizedQuery.length < 2) return [];
  const [churches, aliases] = await Promise.all([
    client.church.findMany({
      where: { mergedIntoChurchId: null },
      select: {
        id: true,
        name: true,
        pastorName: true,
        normalizedName: true,
        normalizedPastorName: true,
      },
      take: 250,
    }),
    client.churchAlias.findMany({
      select: {
        normalizedName: true,
        normalizedPastorName: true,
        church: {
          select: {
            id: true,
            name: true,
            pastorName: true,
            normalizedName: true,
            normalizedPastorName: true,
            mergedIntoChurchId: true,
          },
        },
      },
      take: 250,
    }),
  ]);

  const scores = new Map<string, {
    id: string;
    churchName: string;
    pastorName: string;
    score: number;
  }>();
  const consider = (
    church: typeof churches[number],
    candidateName: string,
    candidatePastor: string,
  ) => {
    if ("mergedIntoChurchId" in church && church.mergedIntoChurchId) return;
    const combined = `${candidateName} ${candidatePastor}`;
    let score = 0;
    if (candidateName.startsWith(normalizedQuery)) score = 400;
    else if (combined.startsWith(normalizedQuery)) score = 350;
    else if (candidateName.includes(normalizedQuery)) score = 300;
    else if (combined.includes(normalizedQuery)) score = 250;
    else {
      const fuzzy = similarity(normalizedQuery, candidateName.slice(0, normalizedQuery.length));
      if (fuzzy < 0.55) return;
      score = Math.round(fuzzy * 100);
    }
    const current = scores.get(church.id);
    if (!current || score > current.score) {
      scores.set(church.id, {
        id: church.id,
        churchName: church.name,
        pastorName: church.pastorName,
        score,
      });
    }
  };

  for (const church of churches) {
    consider(church, church.normalizedName, church.normalizedPastorName);
  }
  for (const alias of aliases) {
    consider(alias.church, alias.normalizedName, alias.normalizedPastorName);
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score
      || a.churchName.localeCompare(b.churchName)
      || a.pastorName.localeCompare(b.pastorName))
    .slice(0, Math.min(limit, 12))
    .map(({ score: _score, ...church }) => church);
}
