# Step 03: Pricing, Merchandise, and Stripe Payments

## Human Tasks Required

- [ ] Provide Stripe account access, publishable key, secret key, webhook signing secret, and test-mode confirmation.
- [ ] Confirm active merchandise items, prices, options, and whether any items are per-camper or per-family.
- [ ] Decide whether worker t-shirt checkout remains informational or collects payment through Stripe in a later step.

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

Add configurable registration pricing, optional merchandise pre-orders, clear receipt-style totals, Stripe payment, cash-at-camp selection, and payment status tracking.

## Agent Tasks

- [ ] Extend camp configuration with early base fee, late base fee, early-registration cutover date and time, third-and-additional-child fee, and discount tiers.
- [ ] Add admin-managed merchandise catalog items with name, price, options, and active status.
- [ ] Add the optional merchandise pre-order step to family registration.
- [ ] Calculate family registration fees using the configured early or late base fee for the first two campers and the configured reduced fee for third and additional campers.
- [ ] Display an itemized receipt-style breakdown with each camper, discounts, merchandise line items, separate registration and merchandise subtotals, and a prominent total.
- [ ] Keep the total amount due persistently visible while payment method is selected.
- [ ] Implement pay-now via Stripe for family registration totals.
- [ ] Implement pay-at-camp cash selection that confirms registration while marking payment status unpaid.
- [ ] Store Stripe transaction IDs and payment statuses.
- [ ] Add webhook handling or equivalent server-side confirmation so payment status cannot rely only on client success redirects.
- [ ] Ensure confirmation screens clearly restate payment status and exact cash amount due when unpaid.
- [ ] Add tests for early pricing, late pricing, multi-child discounts, merchandise totals, Stripe success, Stripe failure, webhook idempotency, and cash-at-camp status.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete test registrations for one, two, three, and four campers before and after the configured cutover date and confirm totals.
- [ ] Complete a test Stripe payment and confirm the registration becomes paid only after server-side payment confirmation.
- [ ] Complete a cash-at-camp registration and confirm the exact amount due appears on screen and in stored registration data.
- [ ] Add merchandise selections and confirm order totals and summary records match the displayed receipt.

## Completion Criteria

- [ ] Parents see unmistakable registration, discount, merchandise, and total pricing before submission.
- [ ] Stripe and cash-at-camp payment paths persist accurate payment state.
- [ ] Merchandise pre-orders are stored with enough detail for later reporting and fulfillment.
- [ ] Worker t-shirt payment scope is either explicitly implemented or explicitly deferred.
