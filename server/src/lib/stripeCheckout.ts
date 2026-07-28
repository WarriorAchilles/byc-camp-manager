import prismaClientPkg, { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { loadEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { runCamperCheckInInTransaction } from "./camperCheckInTx.js";
import { sendCheckInConfirmationMail } from "./checkInConfirmationMail.js";
import { writeOpsLog } from "./opsLog.js";
import {
  materializePendingFamilyCampers,
  parsePendingFamilyRegistrationSnapshot,
} from "./pendingFamilyRegistration.js";
import { dispatchFamilyRegistrationConfirmation } from "./registrationConfirmationMail.js";

const {
  CamperPaymentStatus,
  CheckInStatus,
  RegistrationPaymentMethod,
  RegistrationState,
  StripeCheckoutPurpose,
  StripeCheckoutStatus,
} = prismaClientPkg;

const stripeApiVersion = "2026-04-22.dahlia";

type Db = Prisma.TransactionClient;

export type StripeRuntime = {
  stripe: Stripe;
  appPublicUrl: string;
  registrationPublicUrl: string;
  webhookSecret: string;
};

export function getStripeRuntime(): StripeRuntime | null {
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return null;
  }
  return {
    stripe: new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: stripeApiVersion }),
    // This checkout belongs to the posted self-check-in flow, which remains on the admin/check-in origin.
    appPublicUrl: env.ADMIN_PUBLIC_ORIGIN.replace(/\/+$/, ""),
    registrationPublicUrl: env.REGISTRATION_PUBLIC_ORIGIN.replace(/\/+$/, ""),
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
      amountCents: amountCents > 0 ? amountCents : 0,
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
  const customerEmail = campers
    .map((camper) => camper.guardianEmail.trim())
    .find((email) => email.length > 0);

  const session = await input.stripeRuntime.stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: uniqueCamperIds.join(","),
    ...(customerEmail ? { customer_email: customerEmail } : {}),
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
      purpose: StripeCheckoutPurpose.self_check_in,
      currency: "usd",
      status: StripeCheckoutStatus.pending,
    })),
  });

  return { ok: true, url: session.url, stripeSessionId: session.id, amountCents };
}

async function applyCompletedSelfCheckInCheckoutInTransaction(
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
    where: { stripeSessionId: input.session.id, purpose: StripeCheckoutPurpose.self_check_in },
  });
  const selfCheckInRows = sessionRows.filter(
    (sessionRow): sessionRow is typeof sessionRow & { camperId: string } => sessionRow.camperId !== null,
  );
  if (selfCheckInRows.length === 0) {
    return null;
  }
  const firstSessionRow = selfCheckInRows[0];
  if (!firstSessionRow) {
    return null;
  }
  if (selfCheckInRows.every((sessionRow) => sessionRow.status === StripeCheckoutStatus.completed)) {
    return {
      campYearId: firstSessionRow.campYearId,
      campers: selfCheckInRows.map((sessionRow) => ({
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

  for (const sessionRow of selfCheckInRows) {
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
    where: { stripeSessionId: input.session.id, purpose: StripeCheckoutPurpose.self_check_in },
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

async function applyCompletedFamilyCheckoutInTransaction(
  tx: Db,
  input: { session: Stripe.Checkout.Session; now: Date },
): Promise<{
  completed: boolean;
  campYearId?: string;
  camperIds?: string[];
  familyRegistrationId?: string;
}> {
  const sessionRow = await tx.stripeCheckoutSession.findFirst({
    where: {
      stripeSessionId: input.session.id,
      purpose: StripeCheckoutPurpose.family_registration,
    },
  });
  if (!sessionRow?.familyRegistrationId) return { completed: false };
  if (sessionRow.status === StripeCheckoutStatus.completed) {
    const campers = await tx.camper.findMany({
      where: { familyRegistrationId: sessionRow.familyRegistrationId },
      select: { id: true },
    });
    return {
      completed: true,
      campYearId: sessionRow.campYearId,
      camperIds: campers.map((camper) => camper.id),
      familyRegistrationId: sessionRow.familyRegistrationId,
    };
  }
  const paidAmount = input.session.amount_total;
  const paidCurrency = input.session.currency?.toLowerCase() ?? null;
  if (
    input.session.payment_status !== "paid" ||
    paidAmount !== sessionRow.amountCents ||
    paidCurrency !== sessionRow.currency.toLowerCase()
  ) {
    if (input.session.payment_status === "paid") {
      await tx.stripeCheckoutSession.update({
        where: { id: sessionRow.id },
        data: { status: StripeCheckoutStatus.failed },
      });
    }
    return { completed: false };
  }
  const registration = await tx.familyRegistration.findUnique({
    where: { id: sessionRow.familyRegistrationId },
    select: { state: true, paymentMethod: true, paymentStatus: true, totalDueCents: true },
  });
  if (!registration || registration.totalDueCents !== sessionRow.amountCents) {
    await tx.stripeCheckoutSession.update({
      where: { id: sessionRow.id },
      data: { status: StripeCheckoutStatus.failed },
    });
    return { completed: false };
  }
  if (
    registration.paymentMethod !== RegistrationPaymentMethod.stripe ||
    (registration.state !== RegistrationState.pending_payment &&
      !(registration.state === RegistrationState.confirmed && registration.paymentStatus === CamperPaymentStatus.paid_stripe))
  ) {
    return { completed: false };
  }
  const claimed = await tx.familyRegistration.updateMany({
    where: {
      id: sessionRow.familyRegistrationId,
      state: RegistrationState.pending_payment,
      paymentMethod: RegistrationPaymentMethod.stripe,
    },
    data: {
      state: RegistrationState.confirmed,
      paymentStatus: CamperPaymentStatus.paid_stripe,
      amountPaidCents: sessionRow.amountCents,
      confirmedAt: input.now,
      expiresAt: null,
    },
  });
  if (claimed.count !== 1) {
    return { completed: false };
  }
  const campers = await materializePendingFamilyCampers(tx, {
    familyRegistrationId: sessionRow.familyRegistrationId,
    paymentStatus: CamperPaymentStatus.paid_stripe,
    markFeesPaid: true,
  });
  await tx.familyRegistration.update({
    where: { id: sessionRow.familyRegistrationId },
    data: {
      pendingSubmissionSnapshot: Prisma.DbNull,
      pendingCamperCount: 0,
    },
  });
  await tx.stripeCheckoutSession.update({
    where: { id: sessionRow.id },
    data: {
      status: StripeCheckoutStatus.completed,
      paymentIntentId: paymentIntentIdFromSession(input.session),
      completedAt: input.now,
    },
  });
  return {
    completed: true,
    campYearId: sessionRow.campYearId,
    camperIds: campers.map((camper) => camper.id),
    familyRegistrationId: sessionRow.familyRegistrationId,
  };
}

export async function completeCheckoutSessionIfPaid(
  session: Stripe.Checkout.Session,
): Promise<{
  completed: boolean;
  campYearId?: string;
  camperIds?: string[];
  familyRegistrationId?: string;
}> {
  if (session.payment_status !== "paid") {
    return { completed: false };
  }

  const familyRow = await prisma.stripeCheckoutSession.findFirst({
    where: { stripeSessionId: session.id, purpose: StripeCheckoutPurpose.family_registration },
    select: { id: true },
  });
  if (familyRow) {
    const result = await prisma.$transaction((tx) =>
      applyCompletedFamilyCheckoutInTransaction(tx, { session, now: new Date() }),
    );
    if (result.completed) {
      writeOpsLog("stripe_checkout_completed", {
        checkoutPurpose: StripeCheckoutPurpose.family_registration,
        campYearId: result.campYearId,
        stripeSessionId: session.id,
      });
      if (result.familyRegistrationId) {
        await dispatchFamilyRegistrationConfirmation(result.familyRegistrationId);
      }
    }
    return result;
  }

  const now = new Date();
  const result = await prisma.$transaction((tx) =>
    applyCompletedSelfCheckInCheckoutInTransaction(tx, { session, now }),
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

  const campYear = await prisma.campYear.findUnique({
    where: { id: result.campYearId },
    select: { checkInConfirmationEmailsEnabled: true },
  });
  if (campYear?.checkInConfirmationEmailsEnabled) {
    const campersNeedingEmail = result.campers.filter(
      (camperResult) => camperResult.transitionedToCheckedIn,
    );
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
  }

  return {
    completed: true,
    campYearId: result.campYearId,
    camperIds: result.campers.map((camperResult) => camperResult.camperId),
  };
}

export async function createFamilyRegistrationCheckoutSession(input: {
  familyRegistrationId: string;
  stripeRuntime: StripeRuntime;
}): Promise<
  | { ok: true; url: string; stripeSessionId: string; amountCents: number }
  | { ok: false; status: number; error: string }
> {
  const now = new Date();
  const existing = await prisma.familyRegistration.findUnique({
    where: { id: input.familyRegistrationId },
    include: {
      stripeCheckoutSessions: {
        where: { purpose: StripeCheckoutPurpose.family_registration, status: StripeCheckoutStatus.pending },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!existing) return { ok: false, status: 404, error: "registration_not_found" };
  if (existing.state === RegistrationState.confirmed) {
    return { ok: false, status: 409, error: "registration_already_confirmed" };
  }
  if (existing.state !== RegistrationState.pending_payment || (existing.expiresAt && existing.expiresAt <= now)) {
    return { ok: false, status: 410, error: "registration_expired" };
  }
  const existingSessionRow = existing.stripeCheckoutSessions[0];
  if (existing.paymentMethod === RegistrationPaymentMethod.stripe && existingSessionRow) {
    const session = await input.stripeRuntime.stripe.checkout.sessions.retrieve(existingSessionRow.stripeSessionId);
    if (session.url) {
      return {
        ok: true,
        url: session.url,
        stripeSessionId: session.id,
        amountCents: existingSessionRow.amountCents,
      };
    }
  }
  if (existing.paymentMethod !== null) {
    return { ok: false, status: 409, error: "payment_method_already_selected" };
  }
  const claimed = await prisma.familyRegistration.updateMany({
    where: {
      id: input.familyRegistrationId,
      state: RegistrationState.pending_payment,
      paymentMethod: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: { paymentMethod: RegistrationPaymentMethod.stripe },
  });
  if (claimed.count !== 1) return { ok: false, status: 409, error: "payment_action_in_progress" };

  try {
    const registration = await prisma.familyRegistration.findUniqueOrThrow({
      where: { id: input.familyRegistrationId },
      include: {
        campers: { orderBy: { createdAt: "asc" } },
        merchandiseOrderLines: { orderBy: { createdAt: "asc" } },
      },
    });
    if (registration.totalDueCents <= 0) {
      await prisma.familyRegistration.update({
        where: { id: registration.id },
        data: { paymentMethod: null },
      });
      return { ok: false, status: 409, error: "no_balance_due" };
    }
    const pendingRegistration = registration.campers.length === 0
      ? parsePendingFamilyRegistrationSnapshot(registration.pendingSubmissionSnapshot)
      : null;
    const registrationLines = pendingRegistration
      ? pendingRegistration.submission.campers.map((camper, index) => ({
        firstName: camper.firstName,
        lastName: camper.lastName,
        feeDueCents: pendingRegistration.camperFees[index] ?? 0,
      }))
      : registration.campers;
    const lineItems = [
      ...registrationLines
        .filter((camper) => (camper.feeDueCents ?? 0) > 0)
        .map((camper) => ({
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: { name: `Camp registration - ${camper.firstName} ${camper.lastName}`.trim() },
            unit_amount: camper.feeDueCents ?? 0,
          },
        })),
      ...registration.merchandiseOrderLines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency: "usd",
          product_data: {
            name: line.itemNameSnapshot,
            ...(line.selectedOptionsSnapshot
              ? { description: Object.values(line.selectedOptionsSnapshot as Record<string, unknown>).join(", ") }
              : {}),
          },
          unit_amount: line.unitPriceCents,
        },
      })),
    ];
    const successUrl =
      `${input.stripeRuntime.registrationPublicUrl}/register/family?stripe=success` +
      `&registration_id=${encodeURIComponent(registration.id)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      `${input.stripeRuntime.registrationPublicUrl}/register/family?stripe=cancel` +
      `&registration_id=${encodeURIComponent(registration.id)}`;
    const session = await input.stripeRuntime.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: registration.id,
      customer_email: registration.guardianEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        purpose: StripeCheckoutPurpose.family_registration,
        familyRegistrationId: registration.id,
        campYearId: registration.campYearId,
      },
      line_items: lineItems,
    }, { idempotencyKey: `family-registration-${registration.id}-${randomUUID()}` });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    await prisma.stripeCheckoutSession.create({
      data: {
        stripeSessionId: session.id,
        campYearId: registration.campYearId,
        familyRegistrationId: registration.id,
        purpose: StripeCheckoutPurpose.family_registration,
        amountCents: registration.totalDueCents,
        currency: "usd",
        status: StripeCheckoutStatus.pending,
      },
    });
    return {
      ok: true,
      url: session.url,
      stripeSessionId: session.id,
      amountCents: registration.totalDueCents,
    };
  } catch (error) {
    await prisma.familyRegistration.updateMany({
      where: {
        id: input.familyRegistrationId,
        state: RegistrationState.pending_payment,
        paymentMethod: RegistrationPaymentMethod.stripe,
        stripeCheckoutSessions: { none: { purpose: StripeCheckoutPurpose.family_registration } },
      },
      data: { paymentMethod: null },
    });
    throw error;
  }
}

export async function confirmFamilyRegistrationCash(input: { familyRegistrationId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const registration = await tx.familyRegistration.findUnique({ where: { id: input.familyRegistrationId } });
    if (!registration) return { ok: false as const, status: 404, error: "registration_not_found" };
    if (
      registration.state === RegistrationState.confirmed &&
      registration.paymentMethod === RegistrationPaymentMethod.cash
    ) {
      return { ok: true as const, registration };
    }
    if (registration.state !== RegistrationState.pending_payment || (registration.expiresAt && registration.expiresAt <= now)) {
      return { ok: false as const, status: 410, error: "registration_expired" };
    }
    if (registration.paymentMethod !== null) {
      return { ok: false as const, status: 409, error: "payment_method_already_selected" };
    }
    const updated = await tx.familyRegistration.updateMany({
      where: {
        id: registration.id,
        state: RegistrationState.pending_payment,
        paymentMethod: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        state: RegistrationState.confirmed,
        paymentMethod: RegistrationPaymentMethod.cash,
        paymentStatus: CamperPaymentStatus.unpaid,
        amountPaidCents: 0,
        confirmedAt: now,
        expiresAt: null,
      },
    });
    if (updated.count !== 1) {
      return { ok: false as const, status: 409, error: "payment_action_in_progress" };
    }
    await materializePendingFamilyCampers(tx, {
      familyRegistrationId: registration.id,
      paymentStatus: CamperPaymentStatus.unpaid,
      markFeesPaid: false,
    });
    await tx.familyRegistration.update({
      where: { id: registration.id },
      data: {
        pendingSubmissionSnapshot: Prisma.DbNull,
        pendingCamperCount: 0,
      },
    });
    const confirmed = await tx.familyRegistration.findUniqueOrThrow({ where: { id: registration.id } });
    return { ok: true as const, registration: confirmed };
  });
  if (result.ok) {
    await dispatchFamilyRegistrationConfirmation(result.registration.id);
  }
  return result;
}

export async function markCheckoutSessionUnsuccessful(
  session: Stripe.Checkout.Session,
  status: "failed" | "expired",
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.stripeCheckoutSession.findFirst({ where: { stripeSessionId: session.id } });
    if (!row || row.status === StripeCheckoutStatus.completed) return;
    await tx.stripeCheckoutSession.updateMany({
      where: { stripeSessionId: session.id, status: { not: StripeCheckoutStatus.completed } },
      data: { status: status === "failed" ? StripeCheckoutStatus.failed : StripeCheckoutStatus.expired },
    });
    if (row.purpose === StripeCheckoutPurpose.family_registration && row.familyRegistrationId) {
      await tx.familyRegistration.updateMany({
        where: {
          id: row.familyRegistrationId,
          state: RegistrationState.pending_payment,
          paymentMethod: RegistrationPaymentMethod.stripe,
        },
        data: { paymentMethod: null },
      });
    }
  });
}

export async function reconcileFamilyRegistrationCheckout(input: {
  stripeRuntime: StripeRuntime;
  stripeSessionId: string;
  familyRegistrationId: string;
}): Promise<void> {
  const row = await prisma.stripeCheckoutSession.findFirst({
    where: {
      stripeSessionId: input.stripeSessionId,
      familyRegistrationId: input.familyRegistrationId,
      purpose: StripeCheckoutPurpose.family_registration,
    },
  });
  if (!row) return;
  const session = await input.stripeRuntime.stripe.checkout.sessions.retrieve(input.stripeSessionId);
  if (session.payment_status === "paid") await completeCheckoutSessionIfPaid(session);
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
    where: { stripeSessionId: input.stripeSessionId, purpose: StripeCheckoutPurpose.self_check_in },
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
      where: { stripeSessionId: input.stripeSessionId, purpose: StripeCheckoutPurpose.self_check_in },
      orderBy: { createdAt: "asc" },
    });
  }

  const camperIds = currentSessionRows
    .map((sessionRow) => sessionRow.camperId)
    .filter((camperId): camperId is string => camperId !== null);
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
