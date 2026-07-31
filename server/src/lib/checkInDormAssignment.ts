import prismaClientPkg, { type Prisma } from "@prisma/client";
import { autoAssignCampersGreedy } from "./dormAssignmentCore.js";

const { DormPurpose } = prismaClientPkg;

type Db = Prisma.TransactionClient;

/**
 * If the camper has no dorm, runs the same greedy auto-assignment rules as the dorm board
 * (gender + age bracket + capacity + dorms that have an age group). Returns whether a dorm was assigned.
 */
export async function autoAssignCamperDormIfUnassigned(
  tx: Db,
  input: { campYearId: string; campStart: Date; camperId: string },
): Promise<boolean> {
  const camper = await tx.camper.findFirst({
    where: { id: input.camperId, campYearId: input.campYearId, archivedAt: null },
    select: {
      id: true,
      dormId: true,
      gender: true,
      dateOfBirth: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!camper || camper.dormId) {
    return false;
  }

  const dorms = await tx.dorm.findMany({
    where: { campYearId: input.campYearId, purpose: DormPurpose.camper },
    include: { ageGroupBracket: true },
  });
  const dormIds = dorms.map((dorm) => dorm.id);
  if (dormIds.length === 0) {
    return false;
  }

  const groupedCampers = await tx.camper.groupBy({
    by: ["dormId"],
    where: {
      campYearId: input.campYearId,
      archivedAt: null,
      dormId: { in: dormIds },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, number>();
  for (const id of dormIds) {
    counts.set(id, 0);
  }
  for (const row of groupedCampers) {
    if (row.dormId) {
      counts.set(row.dormId, (counts.get(row.dormId) ?? 0) + row._count._all);
    }
  }
  const slots = dorms.map((dorm) => ({
    id: dorm.id,
    name: dorm.name,
    purpose: dorm.purpose,
    genderDesignation: dorm.genderDesignation,
    camperCapacity: dorm.camperCapacity,
    ageGroupBracket: dorm.ageGroupBracket
      ? {
          minAge: dorm.ageGroupBracket.minAge,
          maxAge: dorm.ageGroupBracket.maxAge,
          sortOrder: dorm.ageGroupBracket.sortOrder,
        }
      : null,
  }));

  const pairs = autoAssignCampersGreedy(
    [
      {
        id: camper.id,
        gender: camper.gender,
        dateOfBirth: camper.dateOfBirth,
        lastName: camper.lastName,
        firstName: camper.firstName,
      },
    ],
    counts,
    slots,
    input.campStart,
  );
  const assigned = pairs.find((pair) => pair.camperId === input.camperId);
  if (!assigned) {
    return false;
  }
  await tx.camper.update({
    where: { id: input.camperId },
    data: { dormId: assigned.dormId },
  });
  return true;
}
