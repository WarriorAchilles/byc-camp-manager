import prismaClientPkg, { type Prisma } from "@prisma/client";
import { autoAssignCamperDormIfUnassigned } from "./checkInDormAssignment.js";

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
  checkInStatus: true,
  checkedInAt: true,
  qrToken: true,
  dorm: { select: { id: true, name: true } },
} satisfies Prisma.CamperSelect;

export type CamperCheckInRow = Prisma.CamperGetPayload<{ select: typeof camperCheckInSelect }>;

export function serializeCamperCheckIn(camper: CamperCheckInRow) {
  const dormAssignment = camper.dorm?.name ?? null;
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
    checkInStatus: camper.checkInStatus,
    checkedInAt: camper.checkedInAt?.toISOString() ?? null,
    qrToken: camper.qrToken,
    dormAssignment,
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

  if (input.payments.markPaidCashForGuardianFamily) {
    await tx.camper.updateMany({
      where: {
        campYearId: input.campYearId,
        archivedAt: null,
        guardianEmail: existing.guardianEmail,
        paymentStatus: CamperPaymentStatus.unpaid,
      },
      data: { paymentStatus: CamperPaymentStatus.paid_cash },
    });
  } else if (input.payments.markPaidCashForCamper) {
    await tx.camper.updateMany({
      where: { id: input.camperId, paymentStatus: CamperPaymentStatus.unpaid },
      data: { paymentStatus: CamperPaymentStatus.paid_cash },
    });
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
