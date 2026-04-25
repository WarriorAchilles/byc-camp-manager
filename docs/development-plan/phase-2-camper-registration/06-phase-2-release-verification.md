# Step 06: Phase 2 Release Verification

## Human Tasks Required

- [ ] Confirm final go-live dates for family camper registration and worker registration.
- [ ] Confirm production Stripe, email, domain, and deployment settings are ready.
- [ ] Confirm which additional reports, if any, must include Phase 2 registration, payment, worker, or merchandise data before launch.

## Spec References

- `docs/specs.md` - "1. Overview"
- `docs/specs.md` - "2. Technical Architecture"
- `docs/specs.md` - "Key Technical Considerations"
- `docs/specs.md` - "Camper fields (legacy parity)"
- `docs/specs.md` - "Additional Reports (TBD - Examples for Consideration)"
- `docs/specs.md` - "13. Future / Wish-List Items"
- `docs/specs.md` - "Outstanding Items & TBD Questions"

## Goal

Verify that Phase 2 public registration is accessible, accurate, secure, mobile-friendly, and ready for production release without regressing Phase 1 camp-management workflows.

## Agent Tasks

- [ ] Add end-to-end tests for closed registration, open registration, capacity reached, family camper registration, Stripe payment, cash-at-camp registration, worker registration, confirmation emails, and admin visibility of submitted records.
- [ ] Add accessibility checks for public forms, validation errors, keyboard navigation, labels, focus management, and responsive behavior.
- [ ] Cross-check family camper and worker fields against the latest legacy Google Forms and update field parity notes.
- [ ] Verify submitted family registrations and workers appear correctly in admin lists, dorm assignment, check-in, and reports.
- [ ] Update reports that were confirmed to require Phase 2 data, such as registration summary, financial summary, worker counts, and merchandise order summary.
- [ ] Harden rate limiting, spam prevention, and validation for unauthenticated public routes.
- [ ] Confirm future wish-list items remain out of scope and are documented as deferred.
- [ ] Update deployment documentation with Phase 2 environment variables, Stripe webhook setup, email provider setup, and registration launch checklist.
- [ ] Execute a full release smoke test in a production-like environment.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Run the repository end-to-end test command.
- [ ] Run the repository build command.
- [ ] Complete a full family registration using Stripe test cards and verify admin, email, payment, QR, check-in, and reporting behavior.
- [ ] Complete a full family registration using cash-at-camp and verify admin unpaid status and check-in cash collection behavior.
- [ ] Complete a worker registration and verify admin, email, dorm assignment, and check-in behavior.
- [ ] Test public forms on mobile and desktop viewport sizes.

## Completion Criteria

- [ ] Public family and worker registration can be opened safely by configuration.
- [ ] Phase 2 workflows do not break Phase 1 imports, dorm assignment, check-in, or reports.
- [ ] Production launch prerequisites are documented and either complete or clearly assigned to human owners.
- [ ] Deferred features are documented so they do not silently expand initial release scope.
