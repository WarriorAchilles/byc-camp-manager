# Step 00: Registration Domain Model and Lifecycle

## Human Tasks Required

- [ ] Confirm whether an unpaid Stripe registration temporarily reserves camper capacity and, if so, how long the reservation lasts before it expires.
- [ ] Confirm whether registration records that are abandoned, expired, or cancelled must remain visible to admins for support and audit purposes.
- [ ] Confirm whether the existing `paid_stripe`, `paid_cash`, and `unpaid` labels remain the desired admin-facing payment terminology for family registrations.

## Spec References

- `docs/specs.md` - "4. Registration System"
- `docs/specs.md` - "5. Payment"
- `docs/specs.md` - "Family Registration"
- `docs/specs.md` - "Merchandise Order"
- `docs/specs.md` - "Merchandise Item (Admin-Configured)"
- `docs/specs.md` - "Camper"
- `docs/specs.md` - "Worker (volunteer / staff)"
- `docs/specs.md` - "Camp Configuration"

## Goal

Define and migrate the shared registration data model and lifecycle before building public forms, payments, or confirmation emails. Preserve compatibility with the completed Phase 1 admin, import, dorm, check-in, and reporting workflows.

## Agent Tasks

- [ ] Add a `FamilyRegistration` model and replace the existing scalar-only camper family registration identifier with a real relation.
- [ ] Define explicit registration states such as `pending_payment`, `confirmed`, `expired`, and `cancelled`, including the transitions allowed for Stripe and cash-at-camp paths.
- [ ] Define which registration states count toward camper capacity and how expired capacity reservations are released.
- [ ] Store family-level guardian contact and address data, payment method and status, registration and merchandise subtotals, discounts, total due, amount paid, and relevant timestamps.
- [ ] Store immutable pricing snapshots and receipt line items so later configuration changes do not alter an existing registration's balance or confirmation receipt.
- [ ] Add medical release and legal signature fields at the family registration level, including rendered agreement version or text snapshot, typed or drawn signature data as approved, acknowledgment, signed timestamp, and request IP.
- [ ] Add the camper fields still missing for public legacy parity, including faith responses, church, pastor, t-shirt intent, allergies, medications, and special-needs data, while preserving the Phase 1 operational fields.
- [ ] Add merchandise catalog and order-line models that support active items, configurable options, per-camper or per-family ownership, quantities, and price snapshots.
- [ ] Add worker fields still missing for public legacy parity, including faith-serving response, church, pastor contact, and public-submission provenance.
- [ ] Remove the individual-camper QR feature while preserving the separate camp-year self-check-in token and posted QR workflow:
  - [ ] Drop `Camper.qrToken` and its unique index in a migration; existing per-camper token values do not need to be retained or transformed.
  - [ ] Drop `CampYear.checkInCamperQrScanEnabled` and remove it from camp-year create, update, response, seed, and admin configuration contracts.
  - [ ] Remove individual camper QR allocation and parsing code while retaining camp-year self-check-in token allocation and parsing.
  - [ ] Stop generating or returning camper QR tokens during admin entry, bulk JSON import, CSV import, and public registration.
  - [ ] Remove the staff camper-QR lookup endpoint and camera-scanning mode from the protected Check-in page; retain staff-assisted name search.
  - [ ] Remove the camera-scanning client dependency and scan-only styles if they are no longer used elsewhere.
  - [ ] Update test factories, fixtures, API expectations, and QR-token tests to cover only the posted camp-year self-check-in token behavior.
- [ ] Add an email delivery-attempt model or equivalent durable status record without storing sensitive email bodies in application logs.
- [ ] Define database constraints and indexes for family lookup, registration state, payment reconciliation, Stripe identifiers, camp-year queries, and worker duplicate review.
- [ ] Add migrations and model-level tests for relations, constraints, lifecycle transitions, price snapshots, and backward compatibility with existing Phase 1 records.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command with the test database available so integration tests execute rather than skip.
- [ ] Apply the migrations to a copy of a Phase 1 database and confirm existing campers, workers, fees, check-in records, and Stripe checkout records remain valid after individual QR data is removed.
- [ ] Confirm the camp-year posted self-check-in QR still opens the public self-check-in flow and staff can still assist attendees using name search.
- [ ] Confirm camper create/import responses and stored rows no longer contain an individual QR token.
- [ ] Create representative pending, confirmed Stripe, confirmed cash-at-camp, expired, and cancelled family registrations and confirm their permitted state transitions.
- [ ] Change camp pricing after creating a registration and confirm the stored registration receipt and balance do not change.

## Completion Criteria

- [ ] Every Phase 2 workflow has a defined persistence model and registration lifecycle before public writes are enabled.
- [ ] Existing Phase 1 data and workflows remain compatible with the migrated schema.
- [ ] Capacity, payment, pricing, merchandise, signature, and email-attempt semantics are explicit and testable.
- [ ] Individual camper QR storage, generation, APIs, configuration, staff scanning UI, and tests are removed without removing the camp-year posted self-check-in QR.
