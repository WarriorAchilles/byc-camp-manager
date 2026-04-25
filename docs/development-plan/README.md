# BYC Camp Manager Development Plan

Source spec: `docs/specs.md`

This plan is split into two independently useful phases. Phase 1 builds the protected camp operations system so camp staff can manage imported or manually entered data before public registration is available. Phase 2 adds public camper and worker registration, payment collection, and registration-time notifications.

## Recommended Execution Order

### Phase 1: Camp Management

1. `phase-1-camp-management/01-project-foundation-and-admin-auth.md`
2. `phase-1-camp-management/02-camp-configuration-and-people-data.md`
3. `phase-1-camp-management/03-csv-import-and-admin-entry.md`
4. `phase-1-camp-management/04-dorm-management-and-assignment.md`
5. `phase-1-camp-management/05-check-in-and-arrival-dashboard.md`
6. `phase-1-camp-management/06-operational-reports-and-exports.md`
7. `phase-1-camp-management/07-phase-1-deployment-and-ops-readiness.md`

### Phase 2: Camper Registration

1. `phase-2-camper-registration/01-registration-availability-and-public-shell.md`
2. `phase-2-camper-registration/02-family-camper-registration-flow.md`
3. `phase-2-camper-registration/03-pricing-merchandise-and-stripe-payments.md`
4. `phase-2-camper-registration/04-worker-registration-flow.md`
5. `phase-2-camper-registration/05-registration-confirmation-emails.md`
6. `phase-2-camper-registration/06-phase-2-release-verification.md`

## Global Assumptions

- The first production milestone prioritizes camp operations over public registration, matching the spec note that registration may not be used in the first year.
- Phase 1 still includes worker and dorm leader records because check-in, dorm assignment, imports, and reports need them operationally. Public worker registration itself is deferred to Phase 2.
- Phase 1 may create payment status fields and cash collection UI for imported/admin-entered campers, but Stripe and full online pricing are Phase 2 work.
- The exact Node.js, React, database, and deployment scaffolding should follow the repository's conventions if an application exists by the time each step is executed.
- Future wish-list items are explicitly deferred unless a later product decision moves them into scope.

## Unresolved Product Questions

- Worker t-shirt checkout: decide whether worker shirt selections ever collect Stripe payment or remain informational.
- Reports: confirm which proposed reports beyond dorm rosters are required for the first release.
- Merchandise pricing: define active merchandise items, options, and prices before Phase 2 payment release.
- Check-in confirmation email: confirm final content beyond camper name and dorm assignment.
- Worker matching strategy: confirm whether email + name + camp year is sufficient for duplicate detection.
- Admin/CSV capacity enforcement: confirm whether over-cap admin actions should block or warn only.

## Coverage Checklist

- [ ] `# BYC Camp Manager - Master Specification` - Covered across all Phase 1 and Phase 2 steps.
- [ ] `Outstanding Items & TBD Questions` - Covered in Phase 1 step 6, Phase 1 step 7, Phase 2 step 3, Phase 2 step 4, and Phase 2 step 6.
- [ ] `Table of Contents` - Covered by this index; no implementation work required.
- [ ] `1. Overview` - Covered in Phase 1 step 1 and Phase 2 step 6.
- [ ] `2. Technical Architecture` - Covered in Phase 1 step 1, Phase 1 step 7, and Phase 2 step 6.
- [ ] `Stack` - Covered in Phase 1 step 1 and Phase 1 step 7.
- [ ] `Key Technical Considerations` - Covered in Phase 1 step 5, Phase 1 step 7, Phase 2 step 1, Phase 2 step 2, and Phase 2 step 6.
- [ ] `3. User Roles & Authentication` - Covered in Phase 1 step 1.
- [ ] `Roles` - Covered in Phase 1 step 1.
- [ ] `Authentication` - Covered in Phase 1 step 1.
- [ ] `4. Registration System` - Covered in all Phase 2 steps.
- [ ] `Registration Form Availability` - Covered in Phase 2 step 1.
- [ ] `Family Registration Flow` - Covered in Phase 2 step 2.
- [ ] `Step 1 - Parent / Guardian Information` - Covered in Phase 2 step 2.
- [ ] `Step 2 - Camper Information (repeatable for each child)` - Covered in Phase 2 step 2.
- [ ] `Step 3 - Medical Release & Legal Agreement` - Covered in Phase 2 step 2.
- [ ] `Step 4 - Merchandise Pre-Order (Optional)` - Covered in Phase 2 step 3.
- [ ] `Step 5 - Payment` - Covered in Phase 2 step 3.
- [ ] `Post-Registration` - Covered in Phase 2 step 5.
- [ ] `Camper fields (legacy parity)` - Covered in Phase 2 step 2 and Phase 2 step 6.
- [ ] `Worker Registration Flow` - Covered in Phase 2 step 4.
- [ ] `Collected fields (same semantics as the Google Form)` - Covered in Phase 2 step 4.
- [ ] `Informational content (not form fields)` - Covered in Phase 2 step 4 and Phase 2 step 5.
- [ ] `Post-worker registration` - Covered in Phase 2 step 4 and Phase 2 step 5.
- [ ] `5. Payment` - Covered in Phase 1 step 5 and Phase 2 step 3.
- [ ] `Stripe Integration` - Covered in Phase 2 step 3.
- [ ] `Worker registration and money` - Covered in Phase 2 step 3 and Phase 2 step 4.
- [ ] `Cash Payments` - Covered in Phase 1 step 5 and Phase 2 step 3.
- [ ] `Multi-Child Discounts and Early / Late Pricing` - Covered in Phase 2 step 3.
- [ ] `6. Camp Management` - Covered in Phase 1 step 2.
- [ ] `Camp Configuration (Super Admin)` - Covered in Phase 1 step 2 and Phase 2 step 1.
- [ ] `People in the System` - Covered in Phase 1 step 2.
- [ ] `7. Check-In` - Covered in Phase 1 step 5.
- [ ] `QR Code Check-In` - Covered in Phase 1 step 5.
- [ ] `Manual Check-In (No QR Code)` - Covered in Phase 1 step 5.
- [ ] `Worker & Dorm Leader Check-In` - Covered in Phase 1 step 5.
- [ ] `Check-In Dashboard` - Covered in Phase 1 step 5.
- [ ] `8. Dorm Management` - Covered in Phase 1 step 4.
- [ ] `Dorm Configuration` - Covered in Phase 1 step 4.
- [ ] `Auto-Assignment` - Covered in Phase 1 step 4.
- [ ] `Manual Assignment (Drag and Drop)` - Covered in Phase 1 step 4.
- [ ] `Dorm Roster View` - Covered in Phase 1 step 4 and Phase 1 step 6.
- [ ] `9. Reports` - Covered in Phase 1 step 6.
- [ ] `Dorm Report (Required)` - Covered in Phase 1 step 6.
- [ ] `Additional Reports (TBD - Examples for Consideration)` - Covered in Phase 1 step 6 and Phase 2 step 6.
- [ ] `10. Email Notifications` - Covered in Phase 1 step 5 and Phase 2 step 5.
- [ ] `1. Family (camper) registration confirmation` - Covered in Phase 2 step 5.
- [ ] `2. Worker registration confirmation` - Covered in Phase 2 step 5.
- [ ] `3. Check-In Confirmation Email` - Covered in Phase 1 step 5.
- [ ] `11. CSV / Spreadsheet Import` - Covered in Phase 1 step 3.
- [ ] `Purpose` - Covered in Phase 1 step 3.
- [ ] `Import Behavior` - Covered in Phase 1 step 3.
- [ ] `Expected CSV Fields` - Covered in Phase 1 step 3.
- [ ] `Worker CSV (optional)` - Covered in Phase 1 step 3.
- [ ] `12. Data Model Overview` - Covered in Phase 1 step 2, Phase 1 step 3, Phase 1 step 4, Phase 1 step 5, Phase 2 step 2, Phase 2 step 3, and Phase 2 step 4.
- [ ] `Family Registration` - Covered in Phase 2 step 2 and Phase 2 step 3.
- [ ] `Merchandise Order` - Covered in Phase 2 step 3.
- [ ] `Merchandise Item (Admin-Configured)` - Covered in Phase 2 step 3.
- [ ] `Camper` - Covered in Phase 1 step 2, Phase 1 step 3, Phase 1 step 5, and Phase 2 step 2.
- [ ] `Worker (volunteer / staff)` - Covered in Phase 1 step 2, Phase 1 step 3, Phase 1 step 5, and Phase 2 step 4.
- [ ] `Dorm Leader` - Covered in Phase 1 step 2, Phase 1 step 4, and Phase 1 step 5.
- [ ] `Dorm` - Covered in Phase 1 step 4.
- [ ] `Camp Configuration` - Covered in Phase 1 step 2, Phase 2 step 1, and Phase 2 step 3.
- [ ] `Admin User` - Covered in Phase 1 step 1.
- [ ] `13. Future / Wish-List Items` - Covered in Phase 1 step 7 and Phase 2 step 6 as deferred scope.
