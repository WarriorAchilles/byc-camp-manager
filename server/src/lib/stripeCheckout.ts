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
  camperIds: string[];
  kioskToken: string;
  stripeRuntime: StripeRuntime;
}): Promise<
  | { ok: true; url: string; stripeSessionId: string; amountCents: number }
  | { ok: false; status: number; error: string }
> {
  const uniqueCamperIds = [...new Set(input.camperIds)];
  if (uniqueCamperIds.length === 0) {
    return { ok: false, status: 400, error: "At least one camper is required" };
  }

  const campers = await prisma.camper.findMany({
    where: { id: { in: uniqueCamperIds }, campYearId: input.campYearId, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      guardianEmail: true,
      paymentStatus: true,
      feeDueCents: true,
      feePaidCents: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  if (campers.length !== uniqueCamperIds.length) {
    return { ok: false, status: 404, error: "One or more campers were not found" };
  }

  const campersWithBalances = campers
    .map((camper) => ({ camper, amountCents: remainingBalanceCents(camper) }))
    .map(({ camper, amountCents }) => ({
      camper,
      amountCents:
        camper.paymentStatus === CamperPaymentStatus.unpaid && amountCents > 0 ? amountCents : 0,
    }));
  const payableCampers = campersWithBalances.filter(({ amountCents }) => amountCents > 0);

  const amountCents = payableCampers.reduce((sum, payableCamper) => sum + payableCamper.amountCents, 0);
  if (amountCents <= 0) {
    return { ok: false, status: 409, error: "No online balance is available for the selected campers" };
  }

  const successUrl =
    `${input.stripeRuntime.appPublicUrl}/self-check-in/${encodeURIComponent(input.kioskToken)}` +
    "?stripe=success&session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl =
    `${input.stripeRuntime.appPublicUrl}/self-check-in/${encodeURIComponent(input.kioskToken)}` +
    `?stripe=cancel`;

  const session = await input.stripeRuntime.stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: uniqueCamperIds.join(","),
    customer_email: campers[0]?.guardianEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      campYearId: input.campYearId,
      camperIds: uniqueCamperIds.join(","),
      source: "self_check_in",
    },
    line_items: payableCampers.map(({ camper, amountCents: camperAmountCents }) => ({
        quantity: 1,
        price_data: {
          currency: "usd",
          product_data: {
            name: `Camp registration balance - ${camper.firstName} ${camper.lastName}`.trim(),
          },
          unit_amount: camperAmountCents,
        },
      })),
  });

  if (!session.url) {
    return { ok: false, status: 502, error: "Stripe did not return a checkout URL" };
  }

  await prisma.stripeCheckoutSession.createMany({
    data: campersWithBalances.map(({ camper, amountCents: camperAmountCents }) => ({
      stripeSessionId: session.id,
      campYearId: input.campYearId,
      camperId: camper.id,
      amountCents: camperAmountCents,
      status: StripeCheckoutStatus.pending,
    })),
  });

  return { ok: true, url: session.url, stripeSessionId: session.id, amountCents };
}

async function applyCompletedCheckoutInTransaction(
  tx: Db,
  input: {
    session: Stripe.Checkout.Session;
    now: Date;
  },
): Promise<
  | {
      campYearId: string;
      campers: Array<{ camperId: string; transitionedToCheckedIn: boolean }>;
    }
  | null
> {
  const sessionRows = await tx.stripeCheckoutSession.findMany({
    where: { stripeSessionId: input.session.id },
  });
  if (sessionRows.length === 0) {
    return null;
  }
  const firstSessionRow = sessionRows[0];
  if (!firstSessionRow) {
    return null;
  }
  if (sessionRows.every((sessionRow) => sessionRow.status === StripeCheckoutStatus.completed)) {
    return {
      campYearId: firstSessionRow.campYearId,
      campers: sessionRows.map((sessionRow) => ({
        camperId: sessionRow.camperId,
        transitionedToCheckedIn: false,
      })),
    };
  }

  const year = await tx.campYear.findUnique({
    where: { id: firstSessionRow.campYearId },
    select: { startDate: true },
  });
  if (!year) {
    return null;
  }

  const completedCampers: Array<{ camperId: string; transitionedToCheckedIn: boolean }> = [];

  for (const sessionRow of sessionRows) {
    if (sessionRow.status === StripeCheckoutStatus.completed) {
      completedCampers.push({ camperId: sessionRow.camperId, transitionedToCheckedIn: false });
      continue;
    }

    const camper = await tx.camper.findFirst({
      where: { id: sessionRow.camperId, campYearId: sessionRow.campYearId, archivedAt: null },
      select: { feeDueCents: true, feePaidCents: true, checkInStatus: true },
    });
    if (!camper) {
      continue;
    }

    if (sessionRow.amountCents > 0) {
      const paidAfterCheckout = (camper.feePaidCents ?? 0) + sessionRow.amountCents;
      const newPaidCents =
        camper.feeDueCents === null
          ? paidAfterCheckout
          : Math.min(paidAfterCheckout, camper.feeDueCents);
      await tx.camper.update({
        where: { id: sessionRow.camperId },
        data: {
          paymentStatus: CamperPaymentStatus.paid_stripe,
          feePaidCents: newPaidCents,
        },
      });
    }

    const checkInResult = await runCamperCheckInInTransaction(tx, {
      campYearId: sessionRow.campYearId,
      camperId: sessionRow.camperId,
      campStart: year.startDate,
      now: input.now,
      payments: {},
    });

    completedCampers.push({
      camperId: sessionRow.camperId,
      transitionedToCheckedIn:
        checkInResult?.transitionedToCheckedIn ?? camper.checkInStatus !== CheckInStatus.checked_in,
    });
  }

  await tx.stripeCheckoutSession.updateMany({
    where: { stripeSessionId: input.session.id },
    data: {
      status: StripeCheckoutStatus.completed,
      paymentIntentId: paymentIntentIdFromSession(input.session),
      completedAt: input.now,
    },
  });

  return {
    campYearId: firstSessionRow.campYearId,
    campers: completedCampers,
  };
}

export async function completeCheckoutSessionIfPaid(
  session: Stripe.Checkout.Session,
): Promise<{ completed: boolean; campYearId?: string; camperIds?: string[] }> {
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

  for (const camperResult of result.campers) {
    writeOpsLog("stripe_checkout_completed", {
      campYearId: result.campYearId,
      camperId: camperResult.camperId,
      stripeSessionId: session.id,
      transitionedToCheckedIn: camperResult.transitionedToCheckedIn,
    });
  }

  const campersNeedingEmail = result.campers.filter((camperResult) => camperResult.transitionedToCheckedIn);
  for (const camperResult of campersNeedingEmail) {
    const camper = await prisma.camper.findUnique({
      where: { id: camperResult.camperId },
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
        camperId: camperResult.camperId,
        channel: "self_service_stripe",
        result: emailResult.status,
      });
    }
  }

  return {
    completed: true,
    campYearId: result.campYearId,
    camperIds: result.campers.map((camperResult) => camperResult.camperId),
  };
}

export async function reconcileCheckoutSession(input: {
  stripeRuntime: StripeRuntime;
  stripeSessionId: string;
  campYearId: string;
}): Promise<
  | {
      ok: true;
      completed: boolean;
      campers: Array<{
        firstName: string;
        lastName: string;
        middleInitial: string | null;
        checkInStatus: string;
        paymentStatus: string;
        dormAssignment: string | null;
      }>;
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
  const sessionRows = await prisma.stripeCheckoutSession.findMany({
    where: { stripeSessionId: input.stripeSessionId },
    orderBy: { createdAt: "asc" },
  });
  if (sessionRows.length === 0) {
    return { ok: false, status: 404, error: "Checkout session not found" };
  }
  const firstSessionRow = sessionRows[0];
  if (!firstSessionRow || firstSessionRow.campYearId !== input.campYearId) {
    return { ok: false, status: 404, error: "Checkout session not found" };
  }

  let currentSessionRows = sessionRows;
  if (currentSessionRows.some((sessionRow) => sessionRow.status !== StripeCheckoutStatus.completed)) {
    const session = await input.stripeRuntime.stripe.checkout.sessions.retrieve(input.stripeSessionId);
    await completeCheckoutSessionIfPaid(session);
    currentSessionRows = await prisma.stripeCheckoutSession.findMany({
      where: { stripeSessionId: input.stripeSessionId },
      orderBy: { createdAt: "asc" },
    });
  }

  const camperIds = currentSessionRows.map((sessionRow) => sessionRow.camperId);
  const campers = await prisma.camper.findMany({
    where: { id: { in: camperIds }, campYearId: firstSessionRow.campYearId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      checkInStatus: true,
      paymentStatus: true,
      dorm: { select: { name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  if (campers.length === 0) {
    return { ok: false, status: 404, error: "Camper not found" };
  }

  const responseCampers = campers.map((camper) => ({
    firstName: camper.firstName,
    lastName: camper.lastName,
    middleInitial: camper.middleName?.trim().charAt(0).toUpperCase() || null,
    checkInStatus: camper.checkInStatus,
    paymentStatus: camper.paymentStatus,
    dormAssignment: camper.dorm?.name ?? null,
  }));
  const firstCamper = responseCampers[0];
  if (!firstCamper) {
    return { ok: false, status: 404, error: "Camper not found" };
  }

  return {
    ok: true,
    completed: currentSessionRows.every((sessionRow) => sessionRow.status === StripeCheckoutStatus.completed),
    campers: responseCampers,
    camper: firstCamper,
  };
}
