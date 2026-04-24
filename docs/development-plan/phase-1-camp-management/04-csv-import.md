# Step 1.04 - CSV Import

## Things for a Human to Complete

- Provide at least one realistic camper CSV export from the external registration process.
- Confirm whether worker CSV import is required in the first operational release or can remain optional.
- Decide how strict import capacity behavior should be when a CSV would exceed the configured camper cap.
- Confirm whether imported rows should ever merge with existing online registrations, or remain separate by camp year as the spec currently states.

## Goal

Allow super admins to import externally registered camper data so dorm assignment, check-in, and reports work even before public registration is launched.

## Agent Implementation Tasks

- Add a super admin CSV upload flow.
- Parse uploaded CSV files safely and validate required camper fields.
- Provide a column-mapping interface for headers that do not match expected names exactly.
- Show a preview screen with parsed rows, normalized values, errors, and warnings before committing.
- Commit valid camper imports in a transaction and mark imported records with `import source = CSV import`.
- Include minimum camper fields: first name, last name, date of birth, gender, parent/guardian name, parent/guardian email, parent/guardian phone, allergies or medical info, and payment status.
- Add optional worker import mode if confirmed, mapping columns to worker registration fields and admin fields.
- Avoid ongoing sync behavior; treat imports as one-time bulk operations.

## Acceptance Criteria

- A malformed CSV does not create partial records.
- Admins can see exactly what will be imported before committing.
- Imported campers behave the same as online-registered campers in dorm assignment, check-in, reports, and QR flows.
- Reasonable header variations can be mapped without changing code.
- The flow surfaces capacity warnings or blocks according to the human-approved policy.

## Master Spec References

- [1. Overview](../../specs.md#1-overview) - requirement that admin management work independently of public registration.
- [11. CSV / Spreadsheet Import](../../specs.md#11-csv--spreadsheet-import) - purpose, import behavior, expected fields, and optional worker import.
- [Expected CSV Fields](../../specs.md#expected-csv-fields) - minimum camper import columns.
- [Worker CSV (optional)](../../specs.md#worker-csv-optional) - optional worker import mapping.
