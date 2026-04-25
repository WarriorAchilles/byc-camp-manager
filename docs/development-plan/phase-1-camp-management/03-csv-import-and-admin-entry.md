# Step 03: CSV Import and Admin Entry

## Human Tasks Required

- [ ] Provide representative camper CSV files if historical exports are available.
- [ ] Confirm whether worker CSV import is required for the first operations release or can remain behind a clearly documented feature flag.

## Spec References

- `docs/specs.md` - "11. CSV / Spreadsheet Import"
- `docs/specs.md` - "Purpose"
- `docs/specs.md` - "Import Behavior"
- `docs/specs.md` - "Expected CSV Fields"
- `docs/specs.md` - "Worker CSV (optional)"
- `docs/specs.md` - "Camper"
- `docs/specs.md` - "Worker (volunteer / staff)"

## Goal

Let super admins bulk import camper data from external registration sources, validate it before commit, and use imported records exactly like online registrations for dorm assignment, check-in, and reports.

## Agent Tasks

- [ ] Add a protected CSV import screen for super admins.
- [ ] Implement CSV parsing with clear validation errors for required camper fields: camper first name, camper last name, date of birth, gender, parent or guardian name, parent or guardian email, parent or guardian phone, allergies or medical info, and payment status.
- [ ] Add flexible header matching for reasonable column-name variations.
- [ ] Add a column-mapping interface for unmatched or ambiguous headers.
- [ ] Show a preview of parsed rows before commit, including errors, warnings, inferred mappings, and capacity impact.
- [ ] Commit valid camper rows with import source set to CSV and generated QR tokens.
- [ ] Treat imported campers identically to online-registered campers in downstream APIs.
- [ ] Add a worker import mode if confirmed for first release; otherwise add code structure and documentation that make the deferral explicit.
- [ ] Ensure imports are one-time bulk imports, not background syncs or merge jobs.
- [ ] Add tests for successful imports, header aliases, validation failures, preview behavior, capacity warnings, and transaction rollback on commit failure.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Upload a valid camper CSV and confirm the preview matches the file.
- [ ] Upload a malformed camper CSV and confirm the UI shows row-level errors without committing records.
- [ ] Commit a valid import and confirm imported campers appear in the camper list with QR tokens and CSV import source.

## Completion Criteria

- [ ] Super admins can import external camper data without direct database access.
- [ ] Invalid data is visible before commit and does not partially import.
- [ ] Imported campers can be used by dorm assignment, check-in, and reports in later steps.
