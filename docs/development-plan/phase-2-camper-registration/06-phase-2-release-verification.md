# Step 06: Phase 2 Release Verification

## Human Tasks Required

- [ ] Confirm final go-live dates for family camper registration and worker registration.
- [ ] Confirm production Stripe, email, DNS/TLS, origin, and deployment settings are ready for both the registration subdomain and the separate admin/check-in origin.
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

Verify that Phase 2 public registration is accessible, accurate, secure, mobile-friendly, isolated to its registration subdomain, and ready for production release without regressing Phase 1 camp-management or check-in workflows.

## Agent Tasks

- [ ] Complete the end-to-end suite established in Step 01 for host isolation, closed registration, open registration, capacity reached, family camper registration, Stripe payment, cash-at-camp registration, worker registration, confirmation emails, and admin visibility of submitted records.
- [ ] Add accessibility checks for public forms, validation errors, keyboard navigation, labels, focus management, and responsive behavior.
- [ ] Cross-check family camper and worker fields against the latest legacy Google Forms and update field parity notes.
- [ ] Verify submitted family registrations and workers appear correctly in admin lists, dorm assignment, check-in, and reports.
- [ ] Update reports that were confirmed to require Phase 2 data, such as registration summary, financial summary, worker counts, and merchandise order summary.
- [ ] Audit and tune the request-size limits, rate limiting, spam prevention, idempotency, safe-IP extraction, and validation added with each unauthenticated public route.
- [ ] Confirm future wish-list items remain out of scope and are documented as deferred.
- [ ] Update deployment documentation with separate registration and admin/check-in public-origin variables, allowed hosts/origins, DNS and TLS setup, routing rules, Stripe webhook setup, Stripe registration redirect behavior, email provider setup, posted camp self-check-in QR generation/display, and registration launch/rollback checklists.
- [ ] Verify admin authentication cookies are not broadened to the registration subdomain and no admin credentials or authenticated responses are exposed there.
- [ ] Verify the registration host does not render admin, staff check-in, or self-check-in pages and the admin/check-in host does not accidentally become the canonical registration origin.
- [ ] Verify Stripe registration redirects and ordinary registration email links use the registration origin, while the camp-level self-check-in QR posted at the physical check-in location uses the admin/check-in origin.
- [ ] Verify family confirmation UI and emails never expose individual camper QR codes, the posted camp self-check-in QR code, or its access URL.
- [ ] Verify the database and APIs no longer store, generate, accept, or return individual camper QR tokens.
- [ ] Verify the staff Check-in page no longer offers camera scanning or an individual camper QR lookup path, while staff name search and the posted camp-level self-check-in QR continue to work.
- [ ] Verify production CORS and host checks explicitly allow only the intended origins and do not reflect arbitrary origins.
- [ ] Review the shared Stripe integration against the go-live checklist, including restricted-key permissions, webhook signature verification, idempotency, event coverage, amount/currency validation, and separate test/live credentials.
- [ ] Confirm application logs and delivery diagnostics do not contain Stripe secrets, guardian email addresses, medical or signature data, or complete worker responses.
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
- [ ] Test registration links from outside an authenticated admin browser session and confirm they resolve to the registration subdomain; scan the physically posted test QR and confirm it resolves to the self-check-in page on the admin/check-in origin.
- [ ] Attempt cross-host navigation and untrusted `Origin`/`Host` requests and confirm they are rejected or routed to the intended safe surface.

## Completion Criteria

- [ ] Public family and worker registration can be opened safely by configuration.
- [ ] Phase 2 workflows do not break Phase 1 imports, dorm assignment, check-in, or reports.
- [ ] Registration and admin/check-in are deployed on separate trusted origins with correct routing, cookies, redirects, email links, and a camp-level self-check-in QR that is distributed only at the physical check-in location.
- [ ] Production launch prerequisites are documented and either complete or clearly assigned to human owners.
- [ ] Deferred features are documented so they do not silently expand initial release scope.
