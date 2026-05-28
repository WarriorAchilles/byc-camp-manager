import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { camperWhereForNameTokens, nameSearchTokens } from "../lib/camperNameSearch.js";
import { runCamperCheckInInTransaction } from "../lib/camperCheckInTx.js";
import { sendCheckInConfirmationMail } from "../lib/checkInConfirmationMail.js";
import { writeOpsLog } from "../lib/opsLog.js";
import { parseSelfCheckInTokenParam } from "../lib/qrToken.js";
import { pathParam } from "../lib/campYearParams.js";
import {
  createSelfCheckInCheckoutSession,
  getStripeRuntime,
  reconcileCheckoutSession,
  remainingBalanceCents,
  stripeNotConfiguredError,
} from "../lib/stripeCheckout.js";
import prismaClientPkg from "@prisma/client";

const { CamperPaymentStatus } = prismaClientPkg;

const router = Router();

function middleInitialFromName(middleName: string | null): string | null {
  const t = middleName?.trim();
  if (!t) {
    return null;
  }
  return t.charAt(0).toUpperCase();
}

const publicCheckInBody = z.object({
  manualPaymentAccepted: z.boolean().optional(),
});

const publicBatchCheckInBody = z.object({
  camperIds: z.array(z.string().uuid()).min(1).max(20),
  manualPaymentAccepted: z.boolean().optional(),
});

const publicStripeCheckoutBody = z.object({
  camperIds: z.array(z.string().uuid()).min(1).max(20).optional(),
});

type SelfCheckInYearResult =
  | {
      year: {
        id: string;
        name: string;
        yearLabel: string;
        startDate: Date;
        selfCheckInToken: string | null;
      };
      normalized: string;
    }
  | { status: 400 | 404; error: string };

async function campYearForSelfCheckInToken(token: string): Promise<SelfCheckInYearResult> {
  const normalized = parseSelfCheckInTokenParam(token);
  if (!normalized) {
    return { status: 400 as const, error: "invalid_token" };
  }
  const year = await prisma.campYear.findUnique({
    where: { selfCheckInToken: normalized },
    select: { id: true, name: true, yearLabel: true, startDate: true, selfCheckInToken: true },
  });
  if (!year) {
    return { status: 404 as const, error: "camp_not_found" };
  }
  return { year, normalized };
}

router.get("/:token/meta", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ campYear: { name: result.year.name, yearLabel: result.year.yearLabel } });
});

router.get("/:token/search", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const tokens = nameSearchTokens(query);
  if (tokens.length === 0) {
    res.status(400).json({ error: "query_required" });
    return;
  }

  const where = camperWhereForNameTokens(result.year.id, tokens);

  const campers = await prisma.camper.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      checkInStatus: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 40,
  });

  res.json({
    campers: campers.map((camper) => ({
      id: camper.id,
      firstName: camper.firstName,
      lastName: camper.lastName,
      middleInitial: middleInitialFromName(camper.middleName),
      checkInStatus: camper.checkInStatus,
    })),
  });
});

router.get("/:token/campers/:camperId/payment-options", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }

  const camper = await prisma.camper.findFirst({
    where: { id: camperId, campYearId: result.year.id, archivedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      paymentStatus: true,
      checkInStatus: true,
      feeDueCents: true,
      feePaidCents: true,
      dorm: { select: { name: true } },
    },
  });
  if (!camper) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  const remaining = remainingBalanceCents(camper);
  res.json({
    camper: {
      id: camper.id,
      firstName: camper.firstName,
      lastName: camper.lastName,
      middleInitial: middleInitialFromName(camper.middleName),
      paymentStatus: camper.paymentStatus,
      checkInStatus: camper.checkInStatus,
      dormAssignment: camper.dorm?.name ?? null,
      remainingBalanceCents: remaining,
      onlinePaymentAvailable: camper.paymentStatus === CamperPaymentStatus.unpaid && remaining > 0,
    },
  });
});

router.post("/:token/campers/:camperId/check-in", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const campYearId = result.year.id;
  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }
  const parsed = publicCheckInBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const currentCamper = await prisma.camper.findFirst({
    where: { id: camperId, campYearId, archivedAt: null },
    select: { paymentStatus: true, feeDueCents: true, feePaidCents: true },
  });
  if (!currentCamper) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }
  const remaining = remainingBalanceCents(currentCamper);
  if (
    currentCamper.paymentStatus === CamperPaymentStatus.unpaid &&
    !parsed.data.manualPaymentAccepted
  ) {
    res.status(409).json({
      error: "payment_required",
      remainingBalanceCents: remaining,
    });
    return;
  }

  const now = new Date();

  const txResult = await prisma.$transaction(async (tx) =>
    runCamperCheckInInTransaction(tx, {
      campYearId,
      camperId,
      campStart: result.year.startDate,
      now,
      payments: {},
    }),
  );

  if (!txResult) {
    res.status(404).json({ error: "Camper not found" });
    return;
  }

  const { camper: finalCamper, transitionedToCheckedIn, dormAutoAssigned } = txResult;

  if (transitionedToCheckedIn) {
    writeOpsLog("camper_check_in_self_service", {
      campYearId,
      camperId,
      dormAutoAssigned,
    });
    const dormLabel = finalCamper.dorm?.name ?? "unassigned";
    const fullName = [finalCamper.firstName, finalCamper.middleName, finalCamper.lastName]
      .filter(Boolean)
      .join(" ");
    const emailResult = await sendCheckInConfirmationMail({
      to: finalCamper.guardianEmail,
      camperFullName: fullName,
      dormLabel,
      checkedInAt: now,
    });
    writeOpsLog("check_in_confirmation_email", {
      campYearId,
      camperId,
      channel: "self_service",
      result: emailResult.status,
    });
  }

  res.json({
    camper: {
      firstName: finalCamper.firstName,
      lastName: finalCamper.lastName,
      middleInitial: middleInitialFromName(finalCamper.middleName),
      checkInStatus: finalCamper.checkInStatus,
      dormAssignment: finalCamper.dorm?.name ?? null,
    },
    alreadyCheckedIn: !transitionedToCheckedIn,
    checkInCompletedThisRequest: transitionedToCheckedIn,
    dormAutoAssigned,
  });
});

router.post("/:token/check-in", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const parsed = publicBatchCheckInBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const campYearId = result.year.id;
  const uniqueCamperIds = [...new Set(parsed.data.camperIds)];
  const currentCampers = await prisma.camper.findMany({
    where: { id: { in: uniqueCamperIds }, campYearId, archivedAt: null },
    select: { id: true, paymentStatus: true, feeDueCents: true, feePaidCents: true },
  });
  if (currentCampers.length !== uniqueCamperIds.length) {
    res.status(404).json({ error: "One or more campers were not found" });
    return;
  }

  const unpaidCamper = currentCampers.find(
    (camper) => camper.paymentStatus === CamperPaymentStatus.unpaid,
  );
  if (unpaidCamper && !parsed.data.manualPaymentAccepted) {
    res.status(409).json({
      error: "payment_required",
      remainingBalanceCents: currentCampers.reduce(
        (sum, camper) =>
          camper.paymentStatus === CamperPaymentStatus.unpaid
            ? sum + remainingBalanceCents(camper)
            : sum,
        0,
      ),
    });
    return;
  }

  const now = new Date();
  const checkInResults = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const camperId of uniqueCamperIds) {
      const txResult = await runCamperCheckInInTransaction(tx, {
        campYearId,
        camperId,
        campStart: result.year.startDate,
        now,
        payments: {},
      });
      if (txResult) {
        results.push(txResult);
      }
    }
    return results;
  });

  for (const txResult of checkInResults) {
    const { camper: finalCamper, transitionedToCheckedIn, dormAutoAssigned } = txResult;
    if (!transitionedToCheckedIn) {
      continue;
    }
    writeOpsLog("camper_check_in_self_service", {
      campYearId,
      camperId: finalCamper.id,
      dormAutoAssigned,
    });
    const fullName = [finalCamper.firstName, finalCamper.middleName, finalCamper.lastName]
      .filter(Boolean)
      .join(" ");
    const emailResult = await sendCheckInConfirmationMail({
      to: finalCamper.guardianEmail,
      camperFullName: fullName,
      dormLabel: finalCamper.dorm?.name ?? "unassigned",
      checkedInAt: now,
    });
    writeOpsLog("check_in_confirmation_email", {
      campYearId,
      camperId: finalCamper.id,
      channel: "self_service",
      result: emailResult.status,
    });
  }

  res.json({
    campers: checkInResults.map((txResult) => ({
      camper: {
        firstName: txResult.camper.firstName,
        lastName: txResult.camper.lastName,
        middleInitial: middleInitialFromName(txResult.camper.middleName),
        checkInStatus: txResult.camper.checkInStatus,
        dormAssignment: txResult.camper.dorm?.name ?? null,
      },
      alreadyCheckedIn: !txResult.transitionedToCheckedIn,
      checkInCompletedThisRequest: txResult.transitionedToCheckedIn,
      dormAutoAssigned: txResult.dormAutoAssigned,
    })),
  });
});

router.post("/:token/campers/:camperId/stripe-checkout", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const camperId = pathParam(req.params.camperId);
  if (!camperId || !z.string().uuid().safeParse(camperId).success) {
    res.status(400).json({ error: "Invalid camper id" });
    return;
  }

  const stripeRuntime = getStripeRuntime();
  if (!stripeRuntime) {
    res.status(503).json(stripeNotConfiguredError());
    return;
  }

  const checkout = await createSelfCheckInCheckoutSession({
    campYearId: result.year.id,
    camperIds: [camperId],
    kioskToken: result.normalized,
    stripeRuntime,
  });
  if (!checkout.ok) {
    res.status(checkout.status).json({ error: checkout.error });
    return;
  }

  res.json({
    url: checkout.url,
    stripeSessionId: checkout.stripeSessionId,
    amountCents: checkout.amountCents,
  });
});

router.post("/:token/stripe-checkout", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const parsed = publicStripeCheckoutBody.safeParse(req.body ?? {});
  if (!parsed.success || !parsed.data.camperIds) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const stripeRuntime = getStripeRuntime();
  if (!stripeRuntime) {
    res.status(503).json(stripeNotConfiguredError());
    return;
  }

  const checkout = await createSelfCheckInCheckoutSession({
    campYearId: result.year.id,
    camperIds: parsed.data.camperIds,
    kioskToken: result.normalized,
    stripeRuntime,
  });
  if (!checkout.ok) {
    res.status(checkout.status).json({ error: checkout.error });
    return;
  }

  res.json({
    url: checkout.url,
    stripeSessionId: checkout.stripeSessionId,
    amountCents: checkout.amountCents,
  });
});

router.get("/:token/stripe-checkout/:stripeSessionId/status", async (req, res) => {
  const result = await campYearForSelfCheckInToken(req.params.token ?? "");
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const stripeRuntime = getStripeRuntime();
  if (!stripeRuntime) {
    res.status(503).json(stripeNotConfiguredError());
    return;
  }

  const stripeSessionId = pathParam(req.params.stripeSessionId);
  if (!stripeSessionId || !stripeSessionId.startsWith("cs_")) {
    res.status(400).json({ error: "Invalid Stripe session id" });
    return;
  }

  const status = await reconcileCheckoutSession({
    stripeRuntime,
    stripeSessionId,
    campYearId: result.year.id,
  });
  if (!status.ok) {
    res.status(status.status).json({ error: status.error });
    return;
  }

  res.json(status);
});

export const publicSelfCheckInRouter = router;
