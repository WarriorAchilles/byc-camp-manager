# Phase 3 Church Directory and Offline Payments

## Public API

`GET /api/public/registration/church-suggestions?q={text}`

- Requires 2–100 trimmed characters and uses the shared public registration rate limiter.
- Returns at most eight active canonical results as `{ id, churchName, pastorName }`.
- Searches canonical identities and aliases. Prefix matches rank above substring and fuzzy suggestions.
- Never returns attendee, guardian, count, payment, audit, or admin metadata.
- The opaque `id` is only a convenience hint. Registration submits it as `selectedChurchId` beside the typed pair, and the server validates the pair or resolves it again.

Family, worker, and leader submission contracts accept optional `selectedChurchId`. Free-typed values remain valid when suggestions are empty or unavailable.

## Admin API

All routes require an authenticated `super_admin` or `camp_admin`.

- `GET /api/admin/churches?campYearId={uuid}` — global canonical directory with year-scoped attendee/payment counts.
- `GET /api/admin/churches/cleanup?campYearId={uuid}` — incomplete mappings, submitted/canonical differences, new records, and explainable likely duplicates.
- `PATCH /api/admin/churches/:churchId` — rename a canonical pair and retain the old identity as an alias.
- `POST /api/admin/churches/remap` — deliberately remap selected typed person IDs to an active canonical church.
- `POST /api/admin/churches/merge/preview` — preview source/target identities and affected records.
- `POST /api/admin/churches/merge` — confirmed transactional merge with redirects, reassignment, and audit.
- `GET /api/admin/churches/:churchId/details?campYearId={uuid}` — eligible campers, numeric balances, merchandise context, check-in state, and payment history.
- `POST /api/admin/churches/:churchId/payments` — record an idempotent check/cash payment with explicit camper allocations.
- `POST /api/admin/churches/payments/:paymentId/void` — reverse a payment with a required reason.
- `GET /api/admin/churches/financial-summary?campYearId={uuid}` — church tender totals, allocations, voids, outstanding fees, and export-safe allocation rows.

Payment creation requires `campYearId`, `tender`, positive `amountReceivedCents`, `receivedDate`, UUID `idempotencyKey`, and unique positive camper allocations whose sum equals the received amount. Checks also require `referenceNumber`. Notes are never included in exports.

## CSV Import

The standard camper, worker, and dorm-leader import supports `churchName` and `pastorName` logical columns. Header suggestions recognize common `Church`, `Church name`, `Church presently attending`, `Pastor`, and `Pastor name` labels.

Preview adds one church resolution per valid row:

- `exact_match` — commit reuses the displayed canonical identity.
- `will_create` — commit silently creates the complete exact pair.
- `incomplete_unmapped` — commit preserves the submitted values but creates no church record.

Commit remains transactional and honors capacity enforcement and skip-invalid-row behavior. It uses the same resolver as registration/admin entry and never performs fuzzy mapping.

## Operator Smoke Test

The user starts the local environment; agents do not start the server/client.

1. Run `npm run dev`, sign in as each admin role, and select a camp year.
2. On public family registration, type at least two church-name characters; verify church/pastor options, keyboard navigation, and screen-reader status.
3. Select an option, edit either field, and verify the selection is cleared while free typing remains submittable.
4. Add a second camper and use “Use the same church as the previous camper.”
5. Abandon a review/payment draft and verify no new attendee or church appears.
6. Complete pay-at-camp and Stripe registrations and verify church creation happens only at camper materialization.
7. Preview/import exact, new, and incomplete church pairs; confirm preview predictions match commit.
8. In **Churches**, rename a church, remap one attendee, preview/merge a duplicate, and verify future alias spelling resolves to the survivor.
9. Select a church with unpaid campers. Exclude one, record a check, and verify only selected numeric balances change.
10. Record a partial cash payment with explicit allocations. Attempt an overpayment and verify it is blocked.
11. Verify merchandise remains outstanding, family totals update, and check-in/self-check-in immediately use the reduced numeric balance.
12. Replay the same payment request/idempotency key and verify no duplicate ledger row.
13. Void a payment with a reason; verify balances restore and history retains the original payment and reversal.
14. Verify **Reports → Financial summary** separates church check/cash, reports allocations/voids/outstanding fees, and exports no notes.
15. Verify unauthorized requests return 401 and inactive/unsupported roles return the existing authorization response.

Run `npm run test:e2e` only after the user-started environment is available.
