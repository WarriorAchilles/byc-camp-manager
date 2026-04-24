# BYC Camp Manager Development Plan

This folder breaks `docs/specs.md` into AI-agent-sized development steps. Each step is intended to be independently assignable, with a short human checklist at the top for decisions, credentials, configuration, or external setup that should not be guessed by an agent.

## Phase 1 - Camp Management

Build the protected admin/operations system first so camp can run even if public registration is handled elsewhere in the first year.

1. `phase-1-camp-management/01-project-foundation-and-admin-auth.md`
2. `phase-1-camp-management/02-camp-configuration.md`
3. `phase-1-camp-management/03-people-records-admin-crud.md`
4. `phase-1-camp-management/04-csv-import.md`
5. `phase-1-camp-management/05-dorm-inventory-and-auto-assignment.md`
6. `phase-1-camp-management/06-manual-dorm-management-and-rosters.md`
7. `phase-1-camp-management/07-check-in-workflows.md`
8. `phase-1-camp-management/08-reports-and-operational-email.md`

## Phase 2 - Camper Registration

Add the public registration layer after the admin system is usable. This includes family camper registration, payment, merchandise, worker self-registration, and the non-MVP future items captured by the spec.

1. `phase-2-camper-registration/01-public-registration-availability.md`
2. `phase-2-camper-registration/02-family-and-camper-form.md`
3. `phase-2-camper-registration/03-medical-release-and-merchandise.md`
4. `phase-2-camper-registration/04-pricing-and-payment-choice.md`
5. `phase-2-camper-registration/05-stripe-payments.md`
6. `phase-2-camper-registration/06-registration-confirmation-qr-and-email.md`
7. `phase-2-camper-registration/07-worker-registration.md`
8. `phase-2-camper-registration/08-registration-admin-integration.md`
9. `phase-2-camper-registration/09-future-scope-backlog.md`

## Coverage Notes

- Phase 1 covers the admin-only path described in the spec: authentication, camp configuration, camper/worker/dorm leader records, CSV import, dorm management, check-in, reports, and check-in email.
- Phase 2 covers public camper and worker registration, registration availability windows, capacity blocking, merchandise pre-orders, Stripe and cash payment flows, registration confirmation emails, QR code delivery, and future backlog capture.
- Outstanding human decisions from the spec are called out in the relevant step files: worker shirt checkout, report requirements, merchandise pricing, and check-in confirmation email contents.

## Spec Section Map

- Overview: Phase 1 establishes the independent admin/management path; Phase 2 adds the public registration path.
- Technical Architecture: Step 1.01 covers foundation, API, database, auth, environment, and AWS decision points; Step 1.08 and Step 2.06 cover email and QR code infrastructure.
- User Roles & Authentication: Step 1.01.
- Registration System: Steps 2.01 through 2.08, with worker registration in Step 2.07.
- Payment: Steps 2.04 and 2.05, with cash handling surfaced again in Step 1.07.
- Camp Management: Steps 1.02 and 1.03.
- Check-In: Step 1.07, with check-in email in Step 1.08.
- Dorm Management: Steps 1.05 and 1.06.
- Reports: Step 1.08.
- Email Notifications: Step 1.08 for check-in email; Step 2.06 for family confirmation; Step 2.07 for worker confirmation.
- CSV / Spreadsheet Import: Step 1.04, with registration integration notes in Step 2.08.
- Data Model Overview: Spread across Steps 1.01 through 1.06 and Steps 2.03 through 2.08 where each entity is implemented.
- Future / Wish-List Items: Step 2.09.
