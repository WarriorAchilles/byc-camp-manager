import prismaClientPkg from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./db.js";

const {
  CamperPaymentStatus,
  Gender,
  ImportSource,
  MerchandiseOwnership,
  ReceiptLineType,
  RegistrationPaymentMethod,
  RegistrationState,
} = prismaClientPkg;

async function registrationSchemaIsReady(): Promise<boolean> {
  try {
    await prisma.familyRegistration.findFirst({ take: 1 });
    return true;
  } catch {
    return false;
  }
}

const schemaReady = await registrationSchemaIsReady();

describe.skipIf(!schemaReady)("registration domain persistence", () => {
  let campYearId: string;

  beforeAll(async () => {
    const year = await prisma.campYear.create({
      data: {
        name: "Registration Domain Test Camp",
        yearLabel: `test-${Date.now()}`,
        startDate: new Date("2099-07-01T12:00:00.000Z"),
        endDate: new Date("2099-07-07T12:00:00.000Z"),
        earlyCamperFeeCents: 16500,
        lateCamperFeeCents: 18000,
        thirdPlusCamperFeeCents: 9000,
      },
    });
    campYearId = year.id;
  });

  afterAll(async () => {
    if (campYearId) {
      await prisma.campYear.deleteMany({ where: { id: campYearId } });
    }
    await prisma.$disconnect();
  });

  it("keeps receipt and merchandise price snapshots unchanged when camp pricing changes", async () => {
    const registration = await prisma.familyRegistration.create({
      data: {
        campYearId,
        state: RegistrationState.confirmed,
        guardianName: "Test Guardian",
        guardianEmail: "snapshot@example.com",
        guardianPhone: "5551234567",
        paymentMethod: RegistrationPaymentMethod.cash,
        paymentStatus: CamperPaymentStatus.unpaid,
        registrationSubtotalCents: 16500,
        merchandiseSubtotalCents: 2500,
        discountCents: 0,
        totalDueCents: 19000,
        amountPaidCents: 0,
        pricingSnapshot: { earlyCamperFeeCents: 16500, merchandiseTotalCents: 2500 },
        confirmedAt: new Date(),
        campers: {
          create: {
            campYearId,
            firstName: "Snapshot",
            lastName: "Camper",
            dateOfBirth: new Date("2088-05-01T12:00:00.000Z"),
            gender: Gender.female,
            guardianName: "Test Guardian",
            guardianEmail: "snapshot@example.com",
            guardianPhone: "5551234567",
            paymentStatus: CamperPaymentStatus.unpaid,
            importSource: ImportSource.online_registration,
          },
        },
        receiptLineItems: {
          create: {
            lineType: ReceiptLineType.registration,
            description: "Snapshot Camper - registration",
            quantity: 1,
            unitPriceCents: 16500,
            lineTotalCents: 16500,
            pricingSnapshot: { rateTier: "early_first_two" },
          },
        },
      },
      include: { campers: true, receiptLineItems: true },
    });

    const item = await prisma.merchandiseItem.create({
      data: {
        campYearId,
        name: "Camp shirt",
        priceCents: 2500,
        availableOptions: { sizes: ["S", "M", "L"] },
        ownership: MerchandiseOwnership.camper,
      },
    });
    await prisma.merchandiseOrderLine.create({
      data: {
        familyRegistrationId: registration.id,
        merchandiseItemId: item.id,
        camperId: registration.campers[0]!.id,
        ownership: MerchandiseOwnership.camper,
        itemNameSnapshot: "Camp shirt",
        selectedOptionsSnapshot: { size: "M" },
        quantity: 1,
        unitPriceCents: 2500,
        lineTotalCents: 2500,
      },
    });

    await prisma.campYear.update({
      where: { id: campYearId },
      data: { earlyCamperFeeCents: 20000 },
    });
    await prisma.merchandiseItem.update({ where: { id: item.id }, data: { priceCents: 3000 } });

    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: registration.id },
      include: { receiptLineItems: true, merchandiseOrderLines: true },
    });
    expect(stored.totalDueCents).toBe(19000);
    expect(stored.receiptLineItems[0]?.unitPriceCents).toBe(16500);
    expect(stored.merchandiseOrderLines[0]?.unitPriceCents).toBe(2500);
    expect(stored.merchandiseOrderLines[0]?.itemNameSnapshot).toBe("Camp shirt");
  });

  it("deletes terminal registrations and their incomplete owned records", async () => {
    const registration = await prisma.familyRegistration.create({
      data: {
        campYearId,
        state: RegistrationState.cancelled,
        guardianName: "Cancelled Guardian",
        guardianEmail: "cancelled@example.com",
        guardianPhone: "5557654321",
        paymentStatus: CamperPaymentStatus.unpaid,
        campers: {
          create: {
            campYearId,
            firstName: "Incomplete",
            lastName: "Camper",
            dateOfBirth: new Date("2088-05-01T12:00:00.000Z"),
            gender: Gender.male,
            guardianName: "Cancelled Guardian",
            guardianEmail: "cancelled@example.com",
            guardianPhone: "5557654321",
            paymentStatus: CamperPaymentStatus.unpaid,
            importSource: ImportSource.online_registration,
          },
        },
        emailDeliveryAttempts: {
          create: {
            templateKey: "registration_confirmation",
            recipientEmail: "cancelled@example.com",
          },
        },
      },
      include: { campers: true, emailDeliveryAttempts: true },
    });

    await prisma.familyRegistration.delete({ where: { id: registration.id } });

    expect(await prisma.camper.findUnique({ where: { id: registration.campers[0]!.id } })).toBeNull();
    expect(
      await prisma.emailDeliveryAttempt.findUnique({
        where: { id: registration.emailDeliveryAttempts[0]!.id },
      }),
    ).toBeNull();
  });
});
