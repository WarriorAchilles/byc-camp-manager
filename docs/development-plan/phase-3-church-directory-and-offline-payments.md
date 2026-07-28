# Phase 3: Church Directory, Cleanup, and Offline Church Payments

## Human Tasks Required

- [ ] None. The product decisions needed for this phase were confirmed before this plan was written.

## Confirmed Product Decisions

- Churches are first-class records shared across camp years.
- A church's registration identity is the normalized pair of **church name + pastor name**. The pair is unique; churches with the same name and different pastors remain separate.
- Public registration never asks a registrant to create a church or choose an "add new church" action.
- Church-name entry remains a normal editable field. Existing canonical churches are suggested while the registrant types, but the registrant may ignore the suggestions and finish typing.
- When a submitted normalized church/pastor pair does not exist, the server silently creates it when the attendee record is confirmed.
- Exact normalized pairs may be matched automatically. Fuzzy similarity may suggest cleanup candidates but must never merge or remap records automatically.
- Admins can rename a canonical church, remap selected attendees, and merge duplicate church records.
- Church payments are recorded by admins as in-person **check** or **cash** payments. No Stripe Checkout Session, PaymentIntent, webhook, or other Stripe behavior is added for church payments.
- A church payment can include or exclude individual campers and is allocated only to the selected campers' registration-fee balances.
- Merchandise is not covered by a church payment in this phase. Any merchandise balance remains assigned to the family registration.

## Spec References

- `docs/specs.md` - "Family Registration Flow"
- `docs/specs.md` - "Step 2 - Camper Information (repeatable for each child)"
- `docs/specs.md` - "Camper fields (legacy parity)"
- `docs/specs.md` - "Worker Registration Flow"
- `docs/specs.md` - "Leader Registration Flow"
- `docs/specs.md` - "5. Payment"
- `docs/specs.md` - "Cash Payments"
- `docs/specs.md` - "6. Camp Management"
- `docs/specs.md` - "People in the System"
- `docs/specs.md` - "7. Check-In"
- `docs/specs.md` - "9. Reports"
- `docs/specs.md` - "Financial Summary"
- `docs/specs.md` - "11. CSV / Spreadsheet Import"
- `docs/specs.md` - "12. Data Model Overview"
- `docs/specs.md` - "Camper"
- `docs/specs.md` - "Worker (volunteer / staff)"
- `docs/specs.md` - "Dorm Leader"

> The master specification currently models church and pastor as scalar person fields and does not yet describe a church directory, church cleanup, or church-funded payments. The confirmed decisions above are the source of truth for this phase until the same requirements are incorporated into `docs/specs.md`.

## Goal

Create a self-maintaining church directory that is populated silently by registrations and imports, reduces inconsistent data entry through public autocomplete, gives admins safe tools to remap and merge duplicate church records, and lets admins apply one offline church check or cash payment across selected campers with a complete audit trail and accurate remaining balances.

## Entry Conditions

- [ ] Phase 2 family registration, registration pricing, and camper materialization are present.
- [ ] The existing Prisma migration workflow and integration-test database are available.
- [ ] Existing camper, worker, dorm-leader, family-registration, check-in, and report behavior passes before this phase begins.

## Current-State Constraints to Preserve

- `Camper`, `Worker`, `WorkerRegistrationSubmission`, and `DormLeader` currently store scalar `churchName` and `pastorName` values.
- Pending family registration data is materialized only after verified Stripe payment or explicit pay-at-camp selection. Abandoned drafts must not create attendee records.
- Camper registration fees are represented by `feeDueCents` and `feePaidCents`, while family registration totals may also contain merchandise.
- Existing payment status values encode both balance state and payment method. New church checks must not be mislabeled as cash, and payment eligibility must ultimately be based on numeric remaining balance.
- Existing Stripe registration and self-check-in paths must continue to work, but they are not extended to accept church payments.
- The application must continue to support admin-created and CSV-imported people even when public registration is not used.

## Recommended Execution Order

### 1. Add the church domain model and migrate existing data

#### Agent Tasks

- [ ] Add a `Church` model with a permanent UUID, canonical church name, normalized church name, canonical pastor name, normalized pastor name, optional `mergedIntoChurchId`, and created/updated timestamps.
- [ ] Enforce a composite unique constraint on the normalized church-name/pastor-name pair.
- [ ] Add a church identity/alias model that can retain display and normalized church/pastor pairs from merges or approved cleanup mappings. Alias pairs must resolve to one active canonical church.
- [ ] Keep merged church rows as non-active redirect records rather than deleting them. Any resolver that encounters a merged row must follow it to the surviving canonical church.
- [ ] Add nullable `churchId` relations to campers, workers, worker registration submissions, and dorm leaders.
- [ ] Preserve the exact submitted church and pastor values for audit/support. Existing scalar fields may remain as submitted-value snapshots or be migrated to explicitly named snapshot fields, but canonical display must come from the related church after mapping.
- [ ] Create one shared, deterministic normalization module used by migrations, public registration, imports, admin edits, autocomplete, and cleanup.
- [ ] Keep automatic identity normalization conservative:
  - [ ] Unicode-normalize, trim, case-fold, collapse whitespace, and ignore insignificant punctuation.
  - [ ] Normalize common pastor honorifics such as `Pastor`, `Rev.`, `Reverend`, `Brother`, and `Bro.` without changing the stored display value.
  - [ ] Do not remove substantive words or use fuzzy matching for automatic identity.
  - [ ] Version or test the normalization rules so later changes cannot silently remap existing records.
- [ ] Backfill churches by exact normalized pair from existing camper, worker, worker-submission, and dorm-leader data.
- [ ] Leave rows that lack either church name or pastor name unmapped and surface them in cleanup instead of inventing an identity.
- [ ] Use transaction-safe upsert/retry behavior so concurrent registrations with the same normalized pair cannot create duplicate churches.
- [ ] Add indexes for canonical lookup, alias lookup, merged-record resolution, and attendee counts by church.

#### Verification

- [ ] Apply the migration to a copy of existing data and confirm exact normalized pairs share one church.
- [ ] Confirm identical church names with different normalized pastor names create separate churches.
- [ ] Confirm capitalization, punctuation, whitespace, and supported pastor-title variations resolve as expected.
- [ ] Confirm an incomplete pair remains reviewable and does not produce a malformed church record.
- [ ] Confirm concurrent upserts for the same pair produce one church.
- [ ] Confirm existing person, dorm, check-in, registration, and payment data remains intact.

#### Completion Criteria

- [ ] Every complete existing church/pastor pair is associated with a canonical church without fuzzy or destructive matching.
- [ ] Original submitted values remain available.
- [ ] The database prevents duplicate exact normalized pairs.

### 2. Add public autocomplete and silent church resolution

#### Agent Tasks

- [ ] Add a public, read-only church suggestion endpoint under the existing registration API.
- [ ] Require a small minimum query length, cap the result count, reuse public registration rate limiting, validate input length, and return only public-safe church and pastor display names plus an opaque church ID.
- [ ] Search active canonical names and aliases. Never return merged rows, camper information, guardian information, attendee counts, payment data, or admin-only metadata.
- [ ] Rank prefix matches ahead of substring and fuzzy matches. Use fuzzy matching only to order suggestions, never to create an association.
- [ ] Update the family camper form so the church input behaves as a normal editable combobox:
  - [ ] Show suggestions after the registrant starts typing.
  - [ ] Display each option as `Church name - Pastor name`.
  - [ ] Support multiple churches with the same displayed church name.
  - [ ] Populate canonical church and pastor display values when a suggestion is selected.
  - [ ] Allow the registrant to ignore suggestions and finish typing without any "add church," "create church," or "church not listed" copy.
  - [ ] Clear the selected church ID if either displayed field is edited after selection.
  - [ ] Support keyboard navigation, focus management, screen readers, loading state, empty results, and request failure without blocking form completion.
- [ ] Add a "use the same church as the previous camper" convenience in multi-camper family registration without forcing siblings to share a church.
- [ ] Send the optional selected church ID together with the typed church and pastor values, but treat all public values as untrusted.
- [ ] At confirmation/materialization time, validate a selected ID against its canonical or alias pair, follow merges, or resolve the submitted normalized pair again.
- [ ] For free-typed pairs, transactionally reuse the exact normalized match or silently create a church. Do not create a church merely because a pending payment draft reached the review screen.
- [ ] Apply the same resolver to accepted worker and dorm-leader registrations so the directory remains shared. A rejected or unresolved duplicate submission must not mutate an existing person's church association.

#### Verification

- [ ] Type a partial church name and confirm suggestions include church and pastor names.
- [ ] Confirm same-name churches with different pastors appear as distinct options.
- [ ] Ignore all suggestions, finish typing, submit through the cash path, and confirm the new church is silently created.
- [ ] Complete a Stripe registration and confirm the church is created/associated only when the registration is successfully materialized.
- [ ] Abandon a pending draft and confirm it does not create a new church.
- [ ] Edit a selected church or pastor and confirm the stale ID is cleared and the edited pair is resolved server-side.
- [ ] Confirm a merged/aliased spelling resolves to the surviving church.
- [ ] Confirm suggestion failure does not prevent registration.
- [ ] Confirm the endpoint exposes no private attendee or payment data.

#### Completion Criteria

- [ ] Registrants can benefit from canonical suggestions without being asked to manage the directory.
- [ ] Unlisted churches are created silently and safely at attendee confirmation.
- [ ] Suggestions reduce duplicates without allowing fuzzy automatic joins.

### 3. Integrate church resolution with admin entry and CSV import

#### Agent Tasks

- [ ] Use the shared exact-pair resolver for admin-created and CSV-imported campers, workers, and dorm leaders when both fields are present.
- [ ] Extend CSV preview to show the submitted pair, exact canonical match when one exists, and whether commit will silently create a new church.
- [ ] Keep import commit transactional and preserve existing capacity, validation, and skip-invalid-row behavior.
- [ ] Store incomplete pairs without creating a church and flag them for cleanup.
- [ ] Update person read contracts to return canonical church identity, submitted values, and mapping status where relevant.
- [ ] Ensure person edit forms distinguish changing submitted text from deliberately remapping to a canonical church.
- [ ] Centralize resolver use so public registration, admin entry, and imports cannot develop different matching rules.

#### Verification

- [ ] Preview and commit a CSV containing exact pairs, normalized variations, new pairs, and incomplete pairs.
- [ ] Confirm the preview accurately predicts reuse, creation, and unmapped results.
- [ ] Confirm repeated rows and concurrent commits do not create duplicate exact pairs.
- [ ] Confirm imported and admin-created campers appear in the same church cleanup and payment workflows as online campers.

#### Completion Criteria

- [ ] Every supported person-creation path follows the same church identity rules.
- [ ] Imports remain previewable and do not perform hidden fuzzy mapping.

### 4. Build the admin church directory and cleanup workflow

#### Agent Tasks

- [ ] Add a protected Church Directory/Cleanup page reachable from the admin navigation.
- [ ] Support camp-year filtering while retaining a global canonical church directory across years.
- [ ] Show canonical church/pastor names, aliases, merge state, and counts for mapped campers, workers, and leaders.
- [ ] Add a review queue for:
  - [ ] Unmapped people with incomplete pairs.
  - [ ] Newly created church records not yet reviewed.
  - [ ] Likely duplicate churches.
  - [ ] People whose submitted values differ from the canonical values to which they are mapped.
- [ ] Generate duplicate suggestions using explainable signals such as exact pastor plus similar church, exact church plus similar pastor, or similarity in both fields.
- [ ] Display the matching signals and affected attendees before an admin acts. Never auto-merge a suggestion.
- [ ] Let an authorized admin:
  - [ ] Rename a canonical church/pastor pair.
  - [ ] Remap selected attendees to an existing church.
  - [ ] Merge one or more source churches into a chosen surviving church.
  - [ ] Correct an individual attendee mapping after a merge.
- [ ] Do not require a separate "create church" workflow. Renaming an automatically created church or remapping to another automatically created church covers cleanup needs.
- [ ] Before merge, show a confirmation preview with source/target identities, aliases, affected people by type and year, and affected church payments.
- [ ] Perform merge in one transaction:
  - [ ] Repoint mapped people and church payments to the survivor.
  - [ ] Preserve source identity pairs as aliases or redirect identities.
  - [ ] Mark source records as merged rather than deleting them.
  - [ ] Resolve alias collisions explicitly instead of silently choosing a target.
- [ ] Record actor, timestamp, action, source, target, and affected record IDs in an audit log for rename, remap, and merge actions.
- [ ] Write safe operational logs without attendee medical, legal, or payment-note contents.
- [ ] Add confirmation dialogs and prevent duplicate submissions while a cleanup mutation is in progress.

#### Verification

- [ ] Confirm likely misspellings are suggested using church and pastor names.
- [ ] Confirm identical church names with different pastors are not treated as exact duplicates.
- [ ] Remap selected campers without moving other attendees from the same source church.
- [ ] Merge duplicate churches and confirm people, aliases, and payments point to the survivor.
- [ ] Submit a future registration using a merged spelling and confirm it resolves to the survivor.
- [ ] Correct an individual mapping after a merge.
- [ ] Confirm every mutation creates an audit record and unauthorized requests are rejected.

#### Completion Criteria

- [ ] Admins can clean existing and future church data without direct database access.
- [ ] Merges preserve history and never rely on automatic fuzzy decisions.
- [ ] Cleanup improves future autocomplete through aliases and redirect identities.

### 5. Add offline church payments with camper allocations

#### Agent Tasks

- [ ] Add a `ChurchPayment` model with church, camp year, tender (`check` or `cash`), amount received in cents, received date, optional check/reference number, optional notes, entering admin, idempotency key, created timestamp, and reversible void metadata.
- [ ] Add `ChurchPaymentAllocation` rows containing the payment, camper, and applied registration-fee amount. Enforce positive values and prevent duplicate camper allocation rows within one payment.
- [ ] Require a check/reference number for checks unless an explicit validation rule documents why it may be omitted.
- [ ] Treat the payment and allocations as an audit ledger. Never create a Stripe object for a church payment.
- [ ] Add a church detail/payment screen for the selected camp year that lists active confirmed campers mapped to the church.
- [ ] Show camper name, guardian/family context, fee due, fee paid, remaining registration-fee balance, family merchandise balance when applicable, and current check-in status.
- [ ] Preselect campers with a positive registration-fee balance. Show already-paid campers but leave them unselected by default.
- [ ] Allow the admin to include/exclude individual campers and show the selected combined remaining balance.
- [ ] Default the received amount and allocations to the exact selected combined balance.
- [ ] If the received amount differs from the selected combined balance, require the admin to review explicit per-camper allocations. Do not silently mark all selected campers paid, over-allocate a camper, apply funds to merchandise, or discard an overpayment.
- [ ] For an overpayment that cannot be allocated, block completion in this phase with a clear message; do not introduce church credit balances without separate product approval.
- [ ] Commit the payment, allocations, camper rollups, and affected family-registration rollups in one transaction with idempotent retry protection.
- [ ] Use numeric balances as the authoritative payment eligibility rule:
  - [ ] `remainingRegistrationFeeCents = max(feeDueCents - feePaidCents, 0)`.
  - [ ] Display `unpaid`, `partially paid`, or `paid` from amounts rather than assuming one payment method from the existing status label.
  - [ ] Preserve existing payment-source information for Stripe and direct family cash while ensuring a church check is never labeled as cash.
  - [ ] Centralize rollup/status synchronization so church payment, individual admin payment, Stripe completion, self-check-in payment, CSV fee import, and payment reversal cannot disagree.
- [ ] Recalculate an affected `FamilyRegistration.amountPaidCents` and remaining total from trusted components. A family stays partially/unpaid when merchandise or another camper balance remains.
- [ ] Do not change registration state, camper check-in state, dorm assignment, or confirmation-email history merely because a church payment is recorded.
- [ ] Update check-in and public self-check-in to recognize the reduced camper registration-fee balance immediately.
- [ ] Add a payment history view with allocations and a controlled void/reversal action that requires a reason and reverses rollups transactionally without deleting the audit record.
- [ ] Prevent reversal from producing negative paid amounts or silently disturbing later allocations; require an explicit conflict response when a later payment depends on the current allocation order.

#### Verification

- [ ] Record a check for all unpaid campers at one church and confirm each selected balance reaches zero.
- [ ] Exclude one camper and confirm only selected campers receive allocations.
- [ ] Record a cash payment and confirm its tender is distinguishable from a check in history and reports.
- [ ] Record a partial payment with reviewed allocations and confirm partial balances are displayed accurately.
- [ ] Attempt an unallocated overpayment and confirm completion is blocked.
- [ ] Confirm a church payment covering registration fees does not mark family merchandise paid.
- [ ] Confirm affected family remaining balances and check-in payment prompts recalculate correctly.
- [ ] Replay the same request and confirm no duplicate payment or allocations are created.
- [ ] Force an allocation failure and confirm no partial payment changes persist.
- [ ] Void a payment and confirm balances are restored while the original payment and reason remain auditable.
- [ ] Confirm no Stripe API or webhook path is called.

#### Completion Criteria

- [ ] Admins can record one check or cash payment and safely allocate it across selected campers at a church.
- [ ] Camper and family balances remain financially consistent.
- [ ] Payment history identifies the church, tender, reference, allocations, actor, and reversals.

### 6. Update reports, harden permissions, and complete release verification

#### Agent Tasks

- [ ] Update camper lists, check-in summaries, and financial reporting to use remaining balance rather than method-encoded status alone.
- [ ] Add church filters and canonical church/pastor columns where useful in camper management and financial reports.
- [ ] Extend the financial summary with church-funded totals separated by check and cash, payment count, allocated amount, voided amount, and outstanding camper registration-fee balances.
- [ ] Ensure merged churches report under the surviving canonical church while retaining drill-down to historical aliases and payment records.
- [ ] Add export coverage for church payments and allocations without exposing admin-only notes unnecessarily.
- [ ] Apply existing admin authorization middleware to every directory, cleanup, merge, payment, and reversal endpoint.
- [ ] Add structured operational logs for church creation, cleanup, merge, payment, and reversal without logging sensitive attendee information.
- [ ] Add end-to-end coverage for autocomplete/free typing, silent creation, cleanup/merge, and an offline church payment.
- [ ] Add responsive and accessibility checks for the public combobox and admin tables/dialogs.
- [ ] Update `docs/specs.md`, API documentation, CSV/import documentation, and any operator smoke-test checklist after implementation so the delivered behavior is no longer documented only in this plan.

#### Verification

- [ ] Run `npm run db:generate`.
- [ ] Apply the Prisma migration using the repository's approved migration workflow.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:e2e` in a user-started local environment; agents must not start the client or server because of repository instructions.
- [ ] Verify public autocomplete and free typing on mobile and desktop.
- [ ] Verify the complete admin cleanup and church-payment workflows with both admin roles according to existing authorization policy.
- [ ] Compare camper, family, check-in, and financial totals before and after a payment and reversal.

#### Completion Criteria

- [ ] Church data is created automatically, suggested safely, and cleanable by admins.
- [ ] Church identity remains stable across camp years, spelling variants, pastor-title variants, and merges.
- [ ] Offline church checks and cash payments are allocated accurately without Stripe.
- [ ] Check-in and reports reflect remaining balances immediately.
- [ ] Automated and manual verification passes without regression to existing registration, import, payment, or check-in workflows.

## Implementation Notes

- Prefer a shared resolver/service over duplicating normalization and church upsert behavior inside route handlers.
- Keep original submissions immutable enough for support and audit; canonical cleanup should change associations and display identity, not rewrite what a registrant originally typed.
- A selected public `churchId` is a convenience hint, not authorization or proof of identity.
- Avoid database delete cascades from a church to people or payments. Church merge is a reassignment plus redirect/archive operation.
- The public suggestion endpoint should remain useful when unavailable: registration must still accept typed church and pastor values.
- Existing family Stripe checkout remains one charge for the family registration. This phase neither changes that rule nor offers Stripe to churches.
- Do not run CDK commands or start the development client/server while implementing this plan. Instruct the user when a live browser workflow requires their locally running environment.

## Follow-Ups

- [ ] Consider collecting optional church city/state in a future registration revision if same-name/same-pastor collisions ever occur in practice.
- [ ] Consider church-level unapplied credits only if overpayments need to be retained rather than rejected or refunded.
- [ ] Consider a church-facing invoice or receipt workflow only if stakeholders request one; it is not required for recording in-person checks or cash.
