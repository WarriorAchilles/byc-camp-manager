import prismaClientPkg from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTransportMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { prisma } from "./db.js";
import { dispatchFamilyRegistrationConfirmation } from "./lib/registrationConfirmationMail.js";

const {
  CamperPaymentStatus,
  ImportSource,
  RegistrationPaymentMethod,
  RegistrationState,
} = prismaClientPkg;

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.emailDeliveryAttempt.findFirst({ select: { idempotencyKey: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();
const originalMailEnv = {
  EMAIL_TRANSPORT: process.env.EMAIL_TRANSPORT,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

function restoreMailEnv(): void {
  for (const [key, value] of Object.entries(originalMailEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe.skipIf(!integrationReady)("registration confirmation delivery records", () => {
  beforeEach(async () => {
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
    process.env.EMAIL_TRANSPORT = "smtp";
    process.env.SMTP_HOST = "smtp.sendgrid.net";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "apikey";
    process.env.SMTP_PASS = "test-only-secret";
    process.env.EMAIL_FROM = "verified@example.test";
    createTransportMock.mockReset();
  });

  afterEach(() => {
    restoreMailEnv();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.$disconnect();
  });

  it("records provider failure, retries the same durable attempt, and suppresses a post-send replay", async () => {
    const camp = await prisma.campYear.create({
      data: {
        name: "Delivery Test Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
      },
    });
    const registration = await prisma.familyRegistration.create({
      data: {
        campYearId: camp.id,
        state: RegistrationState.confirmed,
        guardianName: "Private Guardian",
        guardianEmail: "private-guardian@example.test",
        guardianPhone: "5551234567",
        paymentMethod: RegistrationPaymentMethod.cash,
        paymentStatus: CamperPaymentStatus.unpaid,
        registrationSubtotalCents: 16500,
        totalDueCents: 16500,
        amountPaidCents: 0,
        confirmedAt: new Date(),
        campers: {
          create: {
            campYearId: camp.id,
            firstName: "Private",
            lastName: "Camper",
            dateOfBirth: new Date("2088-05-01T12:00:00Z"),
            gender: "female",
            guardianName: "Private Guardian",
            guardianEmail: "private-guardian@example.test",
            guardianPhone: "5551234567",
            feeDueCents: 16500,
            paymentStatus: CamperPaymentStatus.unpaid,
            importSource: ImportSource.online_registration,
          },
        },
        receiptLineItems: {
          create: {
            lineType: "registration",
            description: "Private Camper registration",
            quantity: 1,
            unitPriceCents: 16500,
            lineTotalCents: 16500,
          },
        },
      },
    });
    const sendMail = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("private body leaked by provider"), { code: "ECONNECTION" }))
      .mockResolvedValueOnce({ messageId: "sendgrid-message-456" });
    createTransportMock.mockReturnValue({ sendMail });
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(await dispatchFamilyRegistrationConfirmation(registration.id)).toEqual({ status: "failed" });
    expect(await prisma.emailDeliveryAttempt.findFirstOrThrow({
      where: { familyRegistrationId: registration.id },
    })).toMatchObject({
      status: "failed",
      attemptNumber: 1,
      errorCode: "ECONNECTION",
      errorMessage: "The email provider rejected the delivery attempt.",
    });

    expect(await dispatchFamilyRegistrationConfirmation(registration.id)).toEqual({ status: "sent" });
    expect(await prisma.emailDeliveryAttempt.findFirstOrThrow({
      where: { familyRegistrationId: registration.id },
    })).toMatchObject({
      status: "sent",
      attemptNumber: 2,
      providerMessageId: "sendgrid-message-456",
      errorCode: null,
      errorMessage: null,
    });

    expect(await dispatchFamilyRegistrationConfirmation(registration.id))
      .toEqual({ status: "duplicate_suppressed" });
    expect(sendMail).toHaveBeenCalledTimes(2);
    const logs = logSpy.mock.calls.flat().join("\n");
    expect(logs).not.toContain("private-guardian@example.test");
    expect(logs).not.toContain("Private Camper");
    expect(logs).not.toContain("private body leaked by provider");
  });
});
