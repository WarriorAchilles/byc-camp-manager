# Step 2.08 - Registration Admin Integration

## Things for a Human to Complete

- Confirm how admins should reconcile mistakes in submitted public registrations.
- Confirm whether admins can manually mark Stripe-paid registrations as refunded or corrected.
- Confirm whether public registration and CSV import are ever used in the same camp year, despite the spec saying they are separate data sources for separate years.
- Confirm retention or export requirements for legal signatures and payment records.

## Goal

Connect public registration data cleanly into the admin operations system built in Phase 1.

## Agent Implementation Tasks

- Add admin views for family registrations with parent/guardian details, camper list, pricing breakdown, payment status, Stripe reference, merchandise orders, legal signature metadata, and email status.
- Link family registration records to camper records used by dorm assignment, check-in, and reports.
- Ensure online-registered campers appear in the same operational workflows as imported campers.
- Add admin filtering for online registration versus CSV import source.
- Surface unpaid cash-at-camp registrations prominently in admin lists, check-in, and financial reporting.
- Ensure merchandise orders appear in reports and registration detail pages.
- Add safeguards so capacity logic is consistent between public registration, admin-created campers, and CSV imports according to the Phase 1 human-approved policy.
- Add audit-friendly display of timestamps, IP address for legal signature, and payment updates.

## Acceptance Criteria

- Admins can inspect the full family registration record behind each online-registered camper.
- Online-registered campers can be assigned to dorms and checked in without special handling.
- Unpaid registrations are easy to find before and during check-in.
- Merchandise pre-orders are visible to admins and available to reporting.
- Legal signature and payment records remain traceable.

## Master Spec References

- [Admin Management](../../specs.md#1-overview) - protected admin interface for registration, payment tracking, dorms, check-in, and reports.
- [Family Registration](../../specs.md#family-registration) - family registration data model.
- [Camper](../../specs.md#camper) - camper import source, QR token, dorm assignment, check-in, and medical release fields.
- [Merchandise Order](../../specs.md#merchandise-order) - merchandise order records tied to family registrations.
- [5. Payment](../../specs.md#5-payment) - payment status and Stripe transaction tracking.
- [CSV / Spreadsheet Import](../../specs.md#11-csv--spreadsheet-import) - CSV and online registration source boundaries.
- [Camp Configuration (Super Admin)](../../specs.md#camp-configuration-super-admin) - capacity behavior across public, admin, and CSV paths.
