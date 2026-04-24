# Step 2.04 - Pricing and Payment Choice

## Things for a Human to Complete

- Confirm the active early base fee, late base fee, third-plus-child fee, and cutover date/time for the launch year.
- Confirm whether sibling discount ordering is simply the order campers are entered, oldest-to-youngest, or another deterministic rule.
- Provide final parent-facing copy explaining online payment versus cash-at-camp payment.
- Confirm whether cash-at-camp registrations are marked unpaid at the family level, camper level, or both for reporting.

## Goal

Make registration pricing clear, configurable, and consistent before online payment is attempted.

## Agent Implementation Tasks

- Implement pricing calculation using configured early base fee, late base fee, cutover date/time, and third-plus-child fee.
- Apply the first-two-child rate and reduced third-plus-child rate for a family registration.
- Include merchandise line items in the total.
- Build a receipt-style pricing breakdown showing each camper fee, discounts, merchandise, registration subtotal, merchandise subtotal, and total due.
- Show struck-through full price and discounted price for discounted campers.
- Keep the total amount due persistently visible while choosing a payment method.
- Let parents choose pay now via Stripe or pay at camp with cash.
- For cash-at-camp, create a confirmed registration with unpaid status and clear total-due messaging.
- Repeat the full pricing breakdown on the post-submission confirmation screen.

## Acceptance Criteria

- Pricing examples from the spec calculate correctly for early and late registration.
- The parent can clearly see exactly what they owe before submitting.
- Cash-at-camp registrations are confirmed but visibly unpaid.
- The confirmation screen clearly restates the exact cash amount due when cash payment is selected.
- Pricing logic is covered by unit tests.

## Master Spec References

- [Step 5 - Payment](../../specs.md#step-5---payment) - pricing clarity, receipt-style breakdown, payment choices, and confirmation screen.
- [5. Payment](../../specs.md#5-payment) - payment status and family registration payment behavior.
- [Cash Payments](../../specs.md#cash-payments) - unpaid cash-at-camp registration handling.
- [Multi-Child Discounts and Early / Late Pricing](../../specs.md#multi-child-discounts-and-early--late-pricing) - early/late fees and sibling discount examples.
- [Camp Configuration (Super Admin)](../../specs.md#camp-configuration-super-admin) - configurable fee schedule.
