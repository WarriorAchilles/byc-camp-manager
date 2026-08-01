import prismaClientPkg from "@prisma/client";
import request from "supertest";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { resetEnvCacheForTests } from "./config/env.js";
import { prisma } from "./db.js";
import {
  completeCheckoutSessionIfPaid,
  confirmFamilyRegistrationCash,
  createFamilyRegistrationCheckoutSession,
  markCheckoutSessionUnsuccessful,
  type StripeRuntime,
} from "./lib/stripeCheckout.js";
import { createPendingFamilyRegistrationSnapshot } from "./lib/pendingFamilyRegistration.js";
import { validFamilySubmission } from "./familyRegistrationTestData.js";

const {
  CamperPaymentStatus,
  CheckInStatus,
  RegistrationPaymentMethod,
  RegistrationState,
  StripeCheckoutPurpose,
  StripeCheckoutStatus,
} = prismaClientPkg;

async function schemaIsReady(): Promise<boolean> {
  try {
    await prisma.familyRegistration.findFirst({ select: { pendingCamperCount: true } });
    return true;
  } catch {
    return false;
  }
}

const integrationReady = await schemaIsReady();

describe.skipIf(!integrationReady)("family registration payments", () => {
  beforeEach(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
  });

  afterAll(async () => {
    await prisma.appSettings.deleteMany({});
    await prisma.emailDeliveryAttempt.deleteMany({});
    await prisma.camper.deleteMany({});
    await prisma.campYear.deleteMany({});
    await prisma.$disconnect();
  });

  async function createRegistration(totalDueCents = 33000) {
    const camp = await prisma.campYear.create({
      data: {
        name: "Payment Camp",
        yearLabel: "2099",
        startDate: new Date("2099-07-01T12:00:00Z"),
        endDate: new Date("2099-07-07T12:00:00Z"),
      },
    });
    const submission = validFamilySubmission();
    submission.guardian = {
      ...submission.guardian,
      fullName: "Payment Guardian",
      email: "payment@example.test",
    };
    submission.legal!.typedName = "Payment Guardian";
    submission.campers = [0, 1].map((index) => ({
      ...submission.campers[0]!,
      firstName: `Pay${index + 1}`,
      guardianName: "Payment Guardian",
    }));
    return prisma.familyRegistration.create({
      data: {
        campYearId: camp.id,
        guardianName: "Payment Guardian",
        guardianEmail: "payment@example.test",
        guardianPhone: "5555555555",
        state: RegistrationState.pending_payment,
        pendingSubmissionSnapshot: createPendingFamilyRegistrationSnapshot(
          submission,
          [totalDueCents / 2, totalDueCents / 2],
        ),
        pendingCamperCount: 2,
        registrationSubtotalCents: totalDueCents,
        totalDueCents,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
      include: { campers: true },
    });
  }

  function runtime(createSession: ReturnType<typeof vi.fn>): StripeRuntime {
    return {
      appPublicUrl: "https://admin.example.test",
      registrationPublicUrl: "https://register.example.test",
      webhookSecret: "whsec_test",
      stripe: {
        checkout: { sessions: { create: createSession } },
      } as unknown as Stripe,
    };
  }

  it("creates one family checkout on the registration origin without fixed payment methods", async () => {
    const registration = await createRegistration();
    expect(registration.campers).toHaveLength(0);
    const createSession = vi.fn().mockResolvedValue({
      id: "cs_family_create",
      url: "https://checkout.stripe.test/family",
    });
    const result = await createFamilyRegistrationCheckoutSession({
      familyRegistrationId: registration.id,
      stripeRuntime: runtime(createSession),
    });
    expect(result).toMatchObject({ ok: true, stripeSessionId: "cs_family_create", amountCents: 33000 });
    const [params] = createSession.mock.calls[0]!;
    expect(params.success_url).toContain("https://register.example.test/register/family");
    expect(params.cancel_url).toContain("https://register.example.test/register/family");
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params.metadata).toMatchObject({ purpose: "family_registration", familyRegistrationId: registration.id });
    expect(await prisma.stripeCheckoutSession.count({
      where: { familyRegistrationId: registration.id, purpose: StripeCheckoutPurpose.family_registration },
    })).toBe(1);
    expect(await prisma.camper.count({ where: { familyRegistrationId: registration.id } })).toBe(0);
  });

  it("completes from verified server data idempotently without check-in side effects", async () => {
    const registration = await createRegistration();
    await prisma.familyRegistration.update({
      where: { id: registration.id },
      data: { paymentMethod: RegistrationPaymentMethod.stripe },
    });
    await prisma.stripeCheckoutSession.create({
      data: {
        stripeSessionId: "cs_family_paid",
        campYearId: registration.campYearId,
        familyRegistrationId: registration.id,
        purpose: StripeCheckoutPurpose.family_registration,
        amountCents: 33000,
        currency: "usd",
      },
    });
    const session = {
      id: "cs_family_paid",
      payment_status: "paid",
      amount_total: 33000,
      currency: "usd",
      payment_intent: "pi_family_paid",
    } as Stripe.Checkout.Session;
    expect(await completeCheckoutSessionIfPaid(session)).toMatchObject({ completed: true });
    expect(await completeCheckoutSessionIfPaid(session)).toMatchObject({ completed: true });
    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: registration.id },
      include: { campers: true, stripeCheckoutSessions: true },
    });
    expect(stored).toMatchObject({
      state: RegistrationState.confirmed,
      paymentStatus: CamperPaymentStatus.paid_stripe,
      amountPaidCents: 33000,
    });
    expect(stored.campers.every((camper) => camper.paymentStatus === CamperPaymentStatus.paid_stripe)).toBe(true);
    expect(stored.campers).toHaveLength(2);
    expect(stored.campers.every((camper) => camper.checkInStatus === CheckInStatus.not_checked_in)).toBe(true);
    expect(stored.stripeCheckoutSessions[0]).toMatchObject({
      status: StripeCheckoutStatus.completed,
      paymentIntentId: "pi_family_paid",
    });
    const attempts = await prisma.emailDeliveryAttempt.findMany({
      where: { familyRegistrationId: registration.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      templateKey: "family_registration_confirmation",
      status: "skipped",
      attemptNumber: 1,
      providerMessageId: null,
    });
  });

  it("verifies and replays the same signed webhook without duplicate payment or check-in email effects", async () => {
    const registration = await createRegistration();
    await prisma.campYear.update({
      where: { id: registration.campYearId },
      data: { checkInConfirmationEmailsEnabled: true },
    });
    await prisma.familyRegistration.update({
      where: { id: registration.id },
      data: { paymentMethod: RegistrationPaymentMethod.stripe },
    });
    await prisma.stripeCheckoutSession.create({
      data: {
        stripeSessionId: "cs_family_webhook_replay",
        campYearId: registration.campYearId,
        familyRegistrationId: registration.id,
        purpose: StripeCheckoutPurpose.family_registration,
        amountCents: 33000,
        currency: "usd",
      },
    });

    const originalKey = process.env.STRIPE_SECRET_KEY;
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const webhookSecret = "whsec_family_registration_test";
    process.env.STRIPE_SECRET_KEY = "rk_test_family_registration_test";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    resetEnvCacheForTests();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const payload = JSON.stringify({
        id: "evt_family_webhook_replay",
        object: "event",
        api_version: "2026-04-22.dahlia",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: "cs_family_webhook_replay",
            object: "checkout.session",
            payment_status: "paid",
            amount_total: 33000,
            currency: "usd",
            payment_intent: "pi_family_webhook_replay",
          },
        },
        livemode: false,
        pending_webhooks: 1,
        request: { id: null, idempotency_key: null },
        type: "checkout.session.completed",
      });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
      const app = createApp();

      const before = await prisma.familyRegistration.findUniqueOrThrow({ where: { id: registration.id } });
      expect(before).toMatchObject({
        state: RegistrationState.pending_payment,
        paymentStatus: CamperPaymentStatus.unpaid,
        amountPaidCents: 0,
      });

      const first = await request(app)
        .post("/api/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", signature)
        .send(payload);
      const replay = await request(app)
        .post("/api/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", signature)
        .send(payload);

      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      const stored = await prisma.familyRegistration.findUniqueOrThrow({
        where: { id: registration.id },
        include: { campers: true, stripeCheckoutSessions: true },
      });
      expect(stored).toMatchObject({
        state: RegistrationState.confirmed,
        paymentStatus: CamperPaymentStatus.paid_stripe,
        amountPaidCents: 33000,
      });
      expect(stored.campers.every((camper) => camper.checkInStatus === CheckInStatus.not_checked_in)).toBe(true);
      expect(stored.stripeCheckoutSessions).toHaveLength(1);
      expect(await prisma.emailDeliveryAttempt.count({
        where: { familyRegistrationId: registration.id },
      })).toBe(1);
      const logs = infoSpy.mock.calls.flat().join("\n");
      expect(logs).toContain("family_registration_confirmation");
      expect(logs).toContain("duplicate_suppressed");
      expect(logs).not.toContain("payment@example.test");
    } finally {
      infoSpy.mockRestore();
      if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalKey;
      if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
      resetEnvCacheForTests();
    }
  });

  it("refuses wrong amounts or currency and leaves registration unpaid", async () => {
    const registration = await createRegistration();
    await prisma.familyRegistration.update({
      where: { id: registration.id },
      data: { paymentMethod: RegistrationPaymentMethod.stripe },
    });
    await prisma.stripeCheckoutSession.create({
      data: {
        stripeSessionId: "cs_family_wrong",
        campYearId: registration.campYearId,
        familyRegistrationId: registration.id,
        purpose: StripeCheckoutPurpose.family_registration,
        amountCents: 33000,
        currency: "usd",
      },
    });
    const result = await completeCheckoutSessionIfPaid({
      id: "cs_family_wrong",
      payment_status: "paid",
      amount_total: 32000,
      currency: "cad",
    } as Stripe.Checkout.Session);
    expect(result.completed).toBe(false);
    expect(await prisma.familyRegistration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject({
      state: RegistrationState.pending_payment,
      paymentStatus: CamperPaymentStatus.unpaid,
      amountPaidCents: 0,
    });
  });

  it("confirms cash atomically, retains amount due, and blocks a later Stripe action", async () => {
    const registration = await createRegistration();
    const first = await confirmFamilyRegistrationCash({ familyRegistrationId: registration.id });
    const replay = await confirmFamilyRegistrationCash({ familyRegistrationId: registration.id });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    const stored = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: registration.id },
      include: { campers: true },
    });
    expect(stored).toMatchObject({
      state: RegistrationState.confirmed,
      paymentMethod: RegistrationPaymentMethod.cash,
      paymentStatus: CamperPaymentStatus.unpaid,
      totalDueCents: 33000,
      amountPaidCents: 0,
    });
    expect(stored.campers).toHaveLength(2);
    expect(await prisma.emailDeliveryAttempt.findFirst({
      where: { familyRegistrationId: registration.id },
    })).toMatchObject({
      templateKey: "family_registration_confirmation",
      status: "skipped",
      attemptNumber: 1,
    });
    const checkout = await createFamilyRegistrationCheckoutSession({
      familyRegistrationId: registration.id,
      stripeRuntime: runtime(vi.fn()),
    });
    expect(checkout).toMatchObject({ ok: false, error: "registration_already_confirmed" });
  });

  it("records delayed failure or expiration and allows another payment choice", async () => {
    const registration = await createRegistration();
    await prisma.familyRegistration.update({
      where: { id: registration.id },
      data: { paymentMethod: RegistrationPaymentMethod.stripe },
    });
    await prisma.stripeCheckoutSession.create({
      data: {
        stripeSessionId: "cs_family_failed",
        campYearId: registration.campYearId,
        familyRegistrationId: registration.id,
        purpose: StripeCheckoutPurpose.family_registration,
        amountCents: 33000,
        currency: "usd",
      },
    });
    await markCheckoutSessionUnsuccessful({ id: "cs_family_failed" } as Stripe.Checkout.Session, "failed");
    expect(await prisma.stripeCheckoutSession.findFirstOrThrow({ where: { stripeSessionId: "cs_family_failed" } }))
      .toMatchObject({ status: StripeCheckoutStatus.failed });
    expect(await prisma.familyRegistration.findUniqueOrThrow({ where: { id: registration.id } }))
      .toMatchObject({ paymentMethod: null, state: RegistrationState.pending_payment });
  });
});
