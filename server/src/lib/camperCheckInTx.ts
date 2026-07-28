import prismaClientPkg, { type Prisma } from "@prisma/client";
import { autoAssignCamperDormIfUnassigned } from "./checkInDormAssignment.js";
import {
  amountBalanceState,
  hasOutstandingRegistrationFee,
  remainingRegistrationFeeCents,
  syncFamilyRegistrationBalance,
} from "./paymentBalances.js";

const { CamperPaymentStatus, CheckInStatus } = prismaClientPkg;

type Db = Prisma.TransactionClient;

/** Full camper row shape used after check-in (admin kiosk + staff dashboards). */
export const camperCheckInSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  dateOfBirth: true,
  gender: true,
  guardianName: true,
  guardianEmail: true,
  guardianPhone: true,
  medicalNotes: true,
  dietaryRestrictions: true,
  paymentStatus: true,
  feeDueCents: true,
  feePaidCents: true,
  checkInStatus: true,
  checkedInAt: true,
  dorm: {
    select: {
      id: true,
      name: true,
      dormLeaderAssignments: {
        where: { archivedAt: null },
        select: { firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
    },
  },
} satisfies Prisma.CamperSelect;

export type CamperCheckInRow = Prisma.CamperGetPayload<{ select: typeof camperCheckInSelect }>;

export function serializeCamperCheckIn(camper: CamperCheckInRow) {
  const dormAssignment = camper.dorm?.name ?? null;
  const dormLeader = camper.dorm?.dormLeaderAssignments.length
    ? camper.dorm.dormLeaderAssignments
        .map((leader) => `${leader.firstName} ${leader.lastName}`)
        .join(", ")
    : null;
  return {
    id: camper.id,
    firstName: camper.firstName,
    lastName: camper.lastName,
    middleName: camper.middleName,
    dateOfBirth: camper.dateOfBirth.toISOString().slice(0, 10),
    gender: camper.gender,
    guardianName: camper.guardianName,
    guardianEmail: camper.guardianEmail,
    guardianPhone: camper.guardianPhone,
    medicalNotes: camper.medicalNotes,
    dietaryRestrictions: camper.dietaryRestrictions,
    paymentStatus: camper.paymentStatus,
    remainingBalanceCents: remainingRegistrationFeeCents(camper),
    balanceState: camper.feeDueCents === null && camper.paymentStatus === CamperPaymentStatus.unpaid
      ? "unpaid"
      : amountBalanceState(camper),
    paymentRequired: hasOutstandingRegistrationFee(camper),
    checkInStatus: camper.checkInStatus,
    checkedInAt: camper.checkedInAt?.toISOString() ?? null,
    dormAssignment,
    dormLeader,
    flags: {
      hasMedicalNotes: !!(camper.medicalNotes && camper.medicalNotes.trim()),
      hasDietaryRestrictions: !!(camper.dietaryRestrictions && camper.dietaryRestrictions.trim()),
    },
  };
}

export type CamperPaymentFlags = {
  markPaidCashForCamper?: boolean;
  markPaidCashForGuardianFamily?: boolean;
};

/**
 * Staff or kiosk flow: optionally mark cash paid, auto-assign dorm if needed, persist check-in.
 * Returns null if the camper is missing or archived for this camp year.
 */
export async function runCamperCheckInInTransaction(
  tx: Db,
  input: {
    campYearId: string;
    camperId: string;
    campStart: Date;
    now: Date;
    payments: CamperPaymentFlags;
  },
): Promise<{
  camper: CamperCheckInRow;
  dormAutoAssigned: boolean;
  transitionedToCheckedIn: boolean;
} | null> {
  const existing = await tx.camper.findFirst({
    where: { id: input.camperId, campYearId: input.campYearId, archivedAt: null },
    select: camperCheckInSelect,
  });
  if (!existing) {
    return null;
  }

  const wasCheckedIn = existing.checkInStatus === CheckInStatus.checked_in;
  let dormAutoAssigned = false;

  if (input.payments.markPaidCashForGuardianFamily && existing.guardianEmail.trim()) {
    const familyCampers = await tx.camper.findMany({
      where: {
        campYearId: input.campYearId,
        archivedAt: null,
        guardianEmail: existing.guardianEmail,
      },
      select: { id: true, feeDueCents: true, feePaidCents: true, familyRegistrationId: true },
    });
    const familyRegistrationIds = new Set<string>();
    for (const camper of familyCampers) {
      if (!hasOutstandingRegistrationFee(camper)) continue;
      await tx.camper.update({
        where: { id: camper.id },
        data: {
          paymentStatus: CamperPaymentStatus.paid_cash,
          feePaidCents: camper.feeDueCents ?? camper.feePaidCents ?? 0,
        },
      });
      if (camper.familyRegistrationId) familyRegistrationIds.add(camper.familyRegistrationId);
    }
    for (const familyRegistrationId of familyRegistrationIds) {
      await syncFamilyRegistrationBalance(tx, familyRegistrationId);
    }
  } else if (input.payments.markPaidCashForCamper || input.payments.markPaidCashForGuardianFamily) {
    if (hasOutstandingRegistrationFee(existing)) {
      await tx.camper.update({
        where: { id: input.camperId },
        data: {
          paymentStatus: CamperPaymentStatus.paid_cash,
          feePaidCents: existing.feeDueCents ?? existing.feePaidCents ?? 0,
        },
      });
      const familyRegistrationId = await tx.camper.findUnique({
        where: { id: input.camperId },
        select: { familyRegistrationId: true },
      });
      if (familyRegistrationId?.familyRegistrationId) {
        await syncFamilyRegistrationBalance(tx, familyRegistrationId.familyRegistrationId);
      }
    }
  }

  if (!wasCheckedIn) {
    dormAutoAssigned = await autoAssignCamperDormIfUnassigned(tx, {
      campYearId: input.campYearId,
      campStart: input.campStart,
      camperId: input.camperId,
    });
  }

  if (!wasCheckedIn) {
    await tx.camper.update({
      where: { id: input.camperId },
      data: {
        checkInStatus: CheckInStatus.checked_in,
        checkedInAt: input.now,
      },
    });
  }

  const camper = await tx.camper.findFirstOrThrow({
    where: { id: input.camperId, campYearId: input.campYearId },
    select: camperCheckInSelect,
  });
  return {
    camper,
    dormAutoAssigned,
    transitionedToCheckedIn: !wasCheckedIn,
  };
}
