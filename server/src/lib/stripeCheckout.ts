import { CamperPaymentStatus, CheckInStatus, StripeCheckoutStatus, type Prisma } from "@prisma/client";
import Stripe from "stripe";
import { loadEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { runCamperCheckInInTransaction } from "./camperCheckInTx.js";
import { sendCheckInConfirmationMail } from "./checkInConfirmationMail.js";
import { writeOpsLog } from "./opsLog.js";

const stripeApiVersion = "2026-04-22.dahlia";

type Db = Prisma.TransactionClient;

export type StripeRuntime = {
  stripe: Stripe;
  appPublicUrl: string;
  webhookSecret: string;
};

export function getStripeRuntime(): StripeRuntime | null {
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.APP_PUBLIC_URL) {
    return null;
  }
  return {
    stripe: new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: stripeApiVersion }),
    appPublicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ""),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  };
}

export function remainingBalanceCents(input: {
  feeDueCents: number | null;
  feePaidCents: number | null;
}): number {
  if (input.feeDueCents === null) {
    return 0;
  }
  return Math.max(input.feeDueCents - (input.feePaidCents ?? 0), 0);
}

export function stripeNotConfiguredError() {
  return { error: "stripe_not_configured" };
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  if (typeof session.payment_intent === "string") {
    return session.payment_intent;
  }
  return session.payment_intent?.id ?? null;
}

export async function createSelfCheckInCheckoutSession(input: {
  campYearId: string;
  camperId: string;
  kioskToken: string;
  stripeRuntime: StripeRuntime;
}): Promise<
  | { ok: true; url: string; stripeSessionId: string; amountCents: number }
  | { ok: false; status: number; error: string }
> {
  const camper = await prisma.camper.findFirst({
    where: { id: input.camperId, campYearId: input.campYearId, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      guardianEmail: true,
      paymentStatus: true,
      feeDueCents: true,
      feePaidCents: true,
    },
  });
  if (!camper) {
    return { ok: false, status: 404, error: "Camper not found" };
  }
  if (camper.paymentStatus !== CamperPaymentStatus.unpaid) {
    return { ok: false, status: 409, error: "Camper is already paid" };
  }

  const amountCents = remainingBalanceCents(camper);
  if (amountCents <= 0) {
    return { ok: false, status: 409, error: "No online balance is available for this camper" };
  }

  const camperName = `${camper.firstName} ${camper.lastName}`.trim();
  const successUrl =
    `${input.stripeRuntime.appPublicUrl}/self-check-in/${encodeURIComponent(input.kioskToken)}` +
    "?stripe=success&session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl =
    `${input.stripeRuntime.appPublicUrl}/self-check-in/${encodeURIComponent(input.kioskToken)}` +
    `?stripe=cancel&camper_id=${encodeURIComponent(input.camperId)}`;

  const session = await input.stripeRuntime.stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: input.camperId,
    customer_email: camper.guardianEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      campYearId: input.campYearId,
      camperId: input.camperId,
      source: "self_check_in",
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          product_data: {
            name: `Camp registration balance - ${camperName}`,
          },
          unit_amount: amountCents,
        },
      },
    ],
  });

  if (!session.url) {
    return { ok: false, status: 502, error: "Stripe did not return a checkout URL" };
  }

  await prisma.stripeCheckoutSession.upsert({
    where: { stripeSessionId: session.id },
    create: {
      stripeSessionId: session.id,
      campYearId: input.campYearId,
      camperId: input.camperId,
      amountCents,
      status: StripeCheckoutStatus.pending,
    },
    update: {
      camperId: input.camperId,
      campYearId: input.campYearId,
      amountCents,
    },
  });

  return { ok: true, url: session.url, stripeSessionId: session.id, amountCents };
}

async function applyCompletedCheckoutInTransaction(
  tx: Db,
  input: {
    session: Stripe.Checkout.Session;
    now: Date;
  },
): Promise<{ campYearId: string; camperId: string; transitionedToCheckedIn: boolean } | null> {
  const sessionRow = await tx.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: input.session.id },
  });
  if (!sessionRow) {
    return null;
  }
  if (sessionRow.status === StripeCheckoutStatus.completed) {
    return {
      campYearId: sessionRow.campYearId,
      camperId: sessionRow.camperId,
      transitionedToCheckedIn: false,
    };
  }

  const year = await tx.campYear.findUnique({
    where: { id: sessionRow.campYearId },
    select: { startDate: true },
  });
  if (!year) {
    return null;
  }

  const camper = await tx.camper.findFirst({
    where: { id: sessionRow.camperId, campYearId: sessionRow.campYearId, archivedAt: null },
    select: { feeDueCents: true, feePaidCents: true, checkInStatus: true },
  });
  if (!camper) {
    return null;
  }

  const paidAfterCheckout = (camper.feePaidCents ?? 0) + sessionRow.amountCents;
  const newPaidCents =
    camper.feeDueCents === null ? paidAfterCheckout : Math.min(paidAfterCheckout, camper.feeDueCents);
  await tx.camper.update({
    where: { id: sessionRow.camperId },
    data: {
      paymentStatus: CamperPaymentStatus.paid_stripe,
      feePaidCents: newPaidCents,
    },
  });

  const checkInResult = await runCamperCheckInInTransaction(tx, {
    campYearId: sessionRow.campYearId,
    camperId: sessionRow.camperId,
    campStart: year.startDate,
    now: input.now,
    payments: {},
  });

  await tx.stripeCheckoutSession.update({
    where: { stripeSessionId: input.session.id },
    data: {
      status: StripeCheckoutStatus.completed,
      paymentIntentId: paymentIntentIdFromSession(input.session),
      completedAt: input.now,
    },
  });

  return {
    campYearId: sessionRow.campYearId,
    camperId: sessionRow.camperId,
    transitionedToCheckedIn:
      checkInResult?.transitionedToCheckedIn ?? camper.checkInStatus !== CheckInStatus.checked_in,
  };
}

export async function completeCheckoutSessionIfPaid(
  session: Stripe.Checkout.Session,
): Promise<{ completed: boolean; campYearId?: string; camperId?: string }> {
  if (session.payment_status !== "paid") {
    return { completed: false };
  }

  const now = new Date();
  const result = await prisma.$transaction((tx) =>
    applyCompletedCheckoutInTransaction(tx, { session, now }),
  );
  if (!result) {
    return { completed: false };
  }

  writeOpsLog("stripe_checkout_completed", {
    campYearId: result.campYearId,
    camperId: result.camperId,
    stripeSessionId: session.id,
    transitionedToCheckedIn: result.transitionedToCheckedIn,
  });

  if (result.transitionedToCheckedIn) {
    const camper = await prisma.camper.findUnique({
      where: { id: result.camperId },
      select: {
        firstName: true,
        middleName: true,
        lastName: true,
        guardianEmail: true,
        checkedInAt: true,
        dorm: { select: { name: true } },
      },
    });
    if (camper) {
      const emailResult = await sendCheckInConfirmationMail({
        to: camper.guardianEmail,
        camperFullName: [camper.firstName, camper.middleName, camper.lastName].filter(Boolean).join(" "),
        dormLabel: camper.dorm?.name ?? "unassigned",
        checkedInAt: camper.checkedInAt ?? new Date(),
      });
      writeOpsLog("check_in_confirmation_email", {
        campYearId: result.campYearId,
        camperId: result.camperId,
        channel: "self_service_stripe",
        result: emailResult.status,
      });
    }
  }

  return { completed: true, campYearId: result.campYearId, camperId: result.camperId };
}

export async function reconcileCheckoutSession(input: {
  stripeRuntime: StripeRuntime;
  stripeSessionId: string;
  campYearId: string;
}): Promise<
  | {
      ok: true;
      completed: boolean;
      camper: {
        firstName: string;
        lastName: string;
        middleInitial: string | null;
        checkInStatus: string;
        paymentStatus: string;
        dormAssignment: string | null;
      };
    }
  | { ok: false; status: number; error: string }
> {
  const sessionRow = await prisma.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: input.stripeSessionId },
  });
  if (!sessionRow) {
    return { ok: false, status: 404, error: "Checkout session not found" };
  }
  if (sessionRow.campYearId !== input.campYearId) {
    return { ok: false, status: 404, error: "Checkout session not found" };
  }

  if (sessionRow.status !== StripeCheckoutStatus.completed) {
    const session = await input.stripeRuntime.stripe.checkout.sessions.retrieve(input.stripeSessionId);
    await completeCheckoutSessionIfPaid(session);
  }

  const camper = await prisma.camper.findFirst({
    where: { id: sessionRow.camperId, campYearId: sessionRow.campYearId },
    select: {
      firstName: true,
      lastName: true,
      middleName: true,
      checkInStatus: true,
      paymentStatus: true,
      dorm: { select: { name: true } },
    },
  });
  if (!camper) {
    return { ok: false, status: 404, error: "Camper not found" };
  }

  return {
    ok: true,
    completed: camper.paymentStatus === CamperPaymentStatus.paid_stripe,
    camper: {
      firstName: camper.firstName,
      lastName: camper.lastName,
      middleInitial: camper.middleName?.trim().charAt(0).toUpperCase() || null,
      checkInStatus: camper.checkInStatus,
      paymentStatus: camper.paymentStatus,
      dormAssignment: camper.dorm?.name ?? null,
    },
  };
}
