# Step 2.02 - Family and Camper Form

## Things for a Human to Complete

- Cross-check every page of the live legacy camper Google Form before release and provide any missing field or option updates.
- Provide final public header copy: camp dates, check-in after 4:00 p.m., age range, venue address, contact phone/email, fee summary, and medical-form notice.
- Confirm whether the family form should be single-page or multi-step.
- Confirm the exact medical, dietary, medication, allergy, emergency contact, and special-needs fields required for camper operations.

## Goal

Build the public family registration form with parent/guardian data and repeatable camper data that preserves legacy form parity.

## Agent Implementation Tasks

- Build the family registration flow shell with parent/guardian information.
- Add repeatable camper sections for one or more campers.
- Collect camper legal first name, last name, optional middle name or initial, date of birth, gender, address, camper cell, parent/guardian name and phone, church/faith fields, pastor name, t-shirt size, medical fields, dietary needs, allergies, medications, emergency contact, and special needs.
- Support a shared family address with optional per-camper override.
- Match legacy option lists for gender, state/province/territory, t-shirt size, Christian yes/no, and Holy Ghost yes/no.
- Validate required fields and numerical-only phone expectations where the legacy form requires them.
- Display admin-configurable camp header content at the top of the public form.
- Persist a draft only if the product chooses to support drafts; otherwise submit only after all required steps are complete.

## Acceptance Criteria

- A parent can submit one family registration containing multiple campers.
- Every required legacy camper field is captured somewhere in the family flow.
- Required fields, option lists, and validation semantics match the legacy form unless explicitly changed by a human.
- Camper data saved from public registration is compatible with existing Phase 1 camper records, dorm assignment, check-in, and reports.
- The form is responsive and accessible on mobile and desktop.

## Master Spec References

- [4. Registration System](../../specs.md#4-registration-system) - public registration scope.
- [Family Registration Flow](../../specs.md#family-registration-flow) - family-level registration structure.
- [Step 1 - Parent / Guardian Information](../../specs.md#step-1---parent--guardian-information) - parent/guardian fields.
- [Step 2 - Camper Information (repeatable for each child)](../../specs.md#step-2---camper-information-repeatable-for-each-child) - repeatable camper fields.
- [Camper fields (legacy parity)](../../specs.md#camper-fields-legacy-parity) - legacy camper field, option, and fee-copy parity.
- [2. Technical Architecture](../../specs.md#2-technical-architecture) - accessible, responsive public form expectation.
