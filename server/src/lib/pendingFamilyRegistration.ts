import prismaClientPkg, { Prisma, type CamperPaymentStatus } from "@prisma/client";
import { z } from "zod";
import {
  familySubmissionSchema,
  type FamilySubmission,
} from "./familyRegistration.js";

const { ImportSource, MerchandiseOwnership } = prismaClientPkg;

const pendingFamilyRegistrationSchema = z.object({
  submission: familySubmissionSchema,
  camperFees: z.array(z.number().int().nonnegative()),
}).superRefine((snapshot, ctx) => {
  if (snapshot.camperFees.length !== snapshot.submission.campers.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["camperFees"],
      message: "Camper fee count must match camper count",
    });
  }
});

export type PendingFamilyRegistration = z.infer<typeof pendingFamilyRegistrationSchema>;

export function createPendingFamilyRegistrationSnapshot(
  submission: FamilySubmission,
  camperFees: number[],
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ submission, camperFees })) as Prisma.InputJsonValue;
}

export function parsePendingFamilyRegistrationSnapshot(value: unknown): PendingFamilyRegistration {
  const parsed = pendingFamilyRegistrationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Pending family registration data is invalid");
  }
  return parsed.data;
}

export async function materializePendingFamilyCampers(
  tx: Prisma.TransactionClient,
  input: {
    familyRegistrationId: string;
    paymentStatus: CamperPaymentStatus;
    markFeesPaid: boolean;
  },
): Promise<Array<{ id: string }>> {
  const registration = await tx.familyRegistration.findUniqueOrThrow({
    where: { id: input.familyRegistrationId },
    include: {
      campers: { orderBy: { createdAt: "asc" }, select: { id: true } },
    },
  });

  // Registrations created before camper materialization was deferred already own
  // camper rows. Keep those rows as the idempotent/legacy path.
  if (registration.campers.length > 0) {
    await tx.camper.updateMany({
      where: { familyRegistrationId: registration.id },
      data: { paymentStatus: input.paymentStatus },
    });
    if (input.markFeesPaid) {
      const campers = await tx.camper.findMany({
        where: { familyRegistrationId: registration.id },
        select: { id: true, feeDueCents: true },
      });
      for (const camper of campers) {
        await tx.camper.update({
          where: { id: camper.id },
          data: { feePaidCents: camper.feeDueCents ?? 0 },
        });
      }
      return campers;
    }
    return registration.campers;
  }

  const snapshot = parsePendingFamilyRegistrationSnapshot(registration.pendingSubmissionSnapshot);
  const created: Array<{ id: string }> = [];

  for (const [index, camper] of snapshot.submission.campers.entries()) {
    const address = camper.useFamilyAddress
      ? snapshot.submission.guardian.address
      : camper.address!;
    const feeDueCents = snapshot.camperFees[index]!;
    const stored = await tx.camper.create({
      data: {
        familyRegistrationId: registration.id,
        campYearId: registration.campYearId,
        firstName: camper.firstName,
        lastName: camper.lastName,
        middleName: camper.middleName || null,
        dateOfBirth: new Date(`${camper.dateOfBirth}T12:00:00.000Z`),
        gender: camper.gender,
        streetAddress: address.streetAddress,
        city: address.city,
        stateOrProvince: address.stateOrProvince,
        postalCode: address.postalCode,
        country: address.country,
        camperCellPhone: camper.camperCellPhone || null,
        guardianName: camper.guardianName,
        guardianEmail: snapshot.submission.guardian.email,
        guardianPhone: camper.guardianPhone,
        identifiesAsChristian: camper.identifiesAsChristian,
        receivedHolyGhost: camper.receivedHolyGhost,
        churchName: camper.churchName,
        pastorName: camper.pastorName,
        tShirtIntent: camper.tShirtIntent,
        medicalNotes: camper.medicalNotes || null,
        allergies: camper.allergies || null,
        medications: camper.medications || null,
        dietaryRestrictions: camper.dietaryRestrictions || null,
        emergencyContactName: camper.emergencyContactName,
        emergencyContactPhone: camper.emergencyContactPhone,
        specialNeeds: camper.specialNeeds || null,
        feeDueCents,
        feePaidCents: input.markFeesPaid ? feeDueCents : 0,
        paymentStatus: input.paymentStatus,
        medicalReleaseSigned: true,
        importSource: ImportSource.online_registration,
      },
      select: { id: true },
    });
    created.push(stored);

    await tx.merchandiseOrderLine.updateMany({
      where: {
        familyRegistrationId: registration.id,
        ownership: MerchandiseOwnership.camper,
        pendingCamperIndex: index,
      },
      data: {
        camperId: stored.id,
        pendingCamperIndex: null,
      },
    });
  }

  const unassignedMerchandise = await tx.merchandiseOrderLine.count({
    where: {
      familyRegistrationId: registration.id,
      ownership: MerchandiseOwnership.camper,
      camperId: null,
    },
  });
  if (unassignedMerchandise > 0) {
    throw new Error("Pending camper merchandise could not be assigned");
  }

  return created;
}
