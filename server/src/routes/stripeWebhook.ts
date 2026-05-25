import express, { Router } from "express";
import {
  completeCheckoutSessionIfPaid,
  getStripeRuntime,
  stripeNotConfiguredError,
} from "../lib/stripeCheckout.js";

const router = Router();

router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const stripeRuntime = getStripeRuntime();
  if (!stripeRuntime) {
    res.status(503).json(stripeNotConfiguredError());
    return;
  }

  const signature = req.header("stripe-signature");
  if (!signature) {
    res.status(400).json({ error: "missing_stripe_signature" });
    return;
  }

  let event;
  try {
    event = stripeRuntime.stripe.webhooks.constructEvent(
      req.body,
      signature,
      stripeRuntime.webhookSecret,
    );
  } catch {
    res.status(400).json({ error: "invalid_stripe_signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    await completeCheckoutSessionIfPaid(event.data.object);
  }

  res.json({ received: true });
});

export const stripeWebhookRouter = router;
