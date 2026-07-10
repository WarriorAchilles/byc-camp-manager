# Step 03: Pricing, Merchandise, and Stripe Payments

## Human Tasks Required

- [ ] Provide Stripe account access, a least-privilege restricted API key, webhook signing secret, and test-mode confirmation; a publishable key is not required for Stripe-hosted Checkout unless the approved UI changes.
- [ ] Confirm active merchandise items, prices, options, and whether any items are per-camper or per-family.
- [ ] Decide whether worker t-shirt checkout remains informational or collects payment through Stripe in a later step.
- [ ] Confirm which dynamically eligible payment methods should be enabled in Stripe Dashboard and how delayed payment methods affect registration confirmation and capacity reservations.

## Spec References

- `docs/specs.md` - "Step 4 - Merchandise Pre-Order (Optional)"
- `docs/specs.md` - "Step 5 - Payment"
- `docs/specs.md` - "5. Payment"
- `docs/specs.md` - "Stripe Integration"
- `docs/specs.md` - "Worker registration and money"
- `docs/specs.md` - "Cash Payments"
- `docs/specs.md` - "Multi-Child Discounts and Early / Late Pricing"
- `docs/specs.md` - "Merchandise Order"
- `docs/specs.md` - "Merchandise Item (Admin-Configured)"
- `docs/specs.md` - "Family Registration"
- `docs/specs.md` - "Camp Configuration"

## Goal

Build registration pricing and merchandise on the existing camp configuration, then extend the existing Stripe-hosted Checkout and verified webhook infrastructure for family registration without coupling registration payment to self check-in.

## Agent Tasks

- [ ] Reuse the existing camp-year early fee, late fee, cutover time, and third-and-additional-camper fee fields and admin controls; add only discount configuration that is approved but not already modeled.
- [ ] Add admin-managed merchandise catalog items with name, price, options, and active status.
- [ ] Add the optional merchandise pre-order step to family registration.
- [ ] Calculate family registration fees using the configured early or late base fee for the first two campers and the configured reduced fee for third and additional campers.
- [ ] Calculate all totals on the server from trusted configuration and submitted quantities; never accept a client-calculated amount as authoritative.
- [ ] Persist the immutable family-level receipt and merchandise price snapshots defined in Step 00 before selecting a payment path.
- [ ] Display an itemized receipt-style breakdown with each camper, discounts, merchandise line items, separate registration and merchandise subtotals, and a prominent total.
- [ ] Keep the total amount due persistently visible while payment method is selected.
- [ ] Refactor the existing Stripe runtime and webhook completion code into shared infrastructure with explicit checkout purposes such as `self_check_in` and `family_registration`.
- [ ] Keep the existing self-check-in Checkout behavior intact, but ensure a family-registration payment never invokes camper check-in, dorm assignment, or check-in confirmation email logic.
- [ ] Implement one Stripe-hosted Checkout Session for the full family registration total, with registration-safe metadata, a unique local checkout record, and success/cancel URLs on the configured registration origin.
- [ ] Continue to omit `payment_method_types` so Stripe Dashboard and dynamic payment methods control eligible methods.
- [ ] Store Stripe Checkout Session and PaymentIntent identifiers at the family payment level, not only on individual camper rows.
- [ ] Extend the verified webhook to route by checkout purpose and process every approved success, delayed-success, failure, expiration, and retry case required by the enabled payment methods.
- [ ] Make webhook processing transactional and idempotent, and verify the Stripe-paid amount and currency match the stored registration balance before marking it paid.
- [ ] Treat the browser success redirect as display/reconciliation only; confirm payment state from the signed webhook or a server-side Stripe retrieval.
- [ ] Implement pay-at-camp cash selection that atomically confirms the registration while marking its family payment status unpaid and retaining the exact amount due.
- [ ] Prevent duplicate or simultaneous cash/Stripe actions from confirming or charging a registration twice.
- [ ] Ensure confirmation screens clearly restate payment status and exact cash amount due when unpaid.
- [ ] Add tests for early pricing, late pricing, multi-child discounts, immutable price snapshots, merchandise totals, server/client amount mismatch, Stripe success, delayed success/failure if enabled, expired checkout, wrong amount or currency, purpose routing, webhook idempotency, duplicate payment actions, cash-at-camp status, and absence of check-in side effects.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete test registrations for one, two, three, and four campers before and after the configured cutover date and confirm totals.
- [ ] Complete a test Stripe payment and confirm the registration becomes paid only after server-side payment confirmation.
- [ ] Confirm Stripe success and cancel redirects remain on the registration subdomain.
- [ ] Confirm a registration Stripe payment does not change camper check-in status or send check-in confirmation emails.
- [ ] Replay the same webhook and confirm payment totals and registration state change only once.
- [ ] Complete a cash-at-camp registration and confirm the exact amount due appears on screen and in stored registration data.
- [ ] Add merchandise selections and confirm order totals and summary records match the displayed receipt.

## Completion Criteria

- [ ] Parents see unmistakable registration, discount, merchandise, and total pricing before submission.
- [ ] Stripe and cash-at-camp payment paths persist accurate payment state.
- [ ] Merchandise pre-orders are stored with enough detail for later reporting and fulfillment.
- [ ] Worker t-shirt payment scope is either explicitly implemented or explicitly deferred.
- [ ] Registration checkout safely reuses shared Stripe infrastructure while remaining isolated from self-check-in behavior and origin URLs.
