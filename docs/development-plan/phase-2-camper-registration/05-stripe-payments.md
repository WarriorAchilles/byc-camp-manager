# Step 2.05 - Stripe Payments

## Things for a Human to Complete

- Create or provide access to the Stripe account.
- Provide Stripe test and live publishable keys, secret keys, webhook signing secrets, and any required product/account settings through secure environment configuration.
- Confirm the Stripe checkout approach, such as Stripe Checkout or Payment Intents with custom UI.
- Confirm refund, failed payment, and abandoned payment handling expectations for launch.
- Confirm whether worker t-shirt checkout should be charged through Stripe now or left informational.

## Goal

Process online card payments for family camper registrations and record trustworthy payment status.

## Agent Implementation Tasks

- Add Stripe server-side integration for the chosen payment approach.
- Create one Stripe payment per family registration covering camper fees minus discounts plus merchandise pre-orders.
- Store Stripe transaction identifiers with the family registration.
- Add webhook handling for successful payment, failed payment, canceled payment, and any required reconciliation events.
- Mark successful online payments as `Paid (Stripe)`.
- Keep cash-at-camp registrations out of Stripe while preserving unpaid status.
- Add admin-visible payment status and Stripe reference details.
- Add tests with mocked Stripe events and webhook signature validation.

## Acceptance Criteria

- A parent can complete online card payment for the exact calculated total.
- Payment status only becomes `Paid (Stripe)` after a verified Stripe success signal.
- Failed or canceled payments do not create a misleading paid registration.
- Webhook endpoints validate Stripe signatures.
- Stripe credentials are never committed.
- Worker t-shirt payment is either explicitly implemented or clearly left out based on the human decision.

## Master Spec References

- [Stripe Integration](../../specs.md#stripe-integration) - online card payments, single family charge, and payment status tracking.
- [Worker registration and money](../../specs.md#worker-registration-and-money) - no worker camp tuition and worker shirt payment TBD.
- [Payment](../../specs.md#5-payment) - broader payment requirements.
- [Outstanding Items & TBD Questions](../../specs.md#outstanding-items--tbd-questions) - worker t-shirt checkout decision.
