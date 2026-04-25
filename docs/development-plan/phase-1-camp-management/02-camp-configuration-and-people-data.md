# Step 02: Camp Configuration and People Data

## Human Tasks Required

- [ ] Confirm any preferred default age group brackets if the shipped seed defaults should differ from the agent's sensible defaults.
- [ ] Decide whether admin-created campers and CSV imports should hard-block at camp capacity or warn while allowing an override.

## Spec References

- `docs/specs.md` - "6. Camp Management"
- `docs/specs.md` - "Camp Configuration (Super Admin)"
- `docs/specs.md` - "People in the System"
- `docs/specs.md` - "12. Data Model Overview"
- `docs/specs.md` - "Camper"
- `docs/specs.md` - "Worker (volunteer / staff)"
- `docs/specs.md` - "Dorm Leader"
- `docs/specs.md` - "Camp Configuration"

## Goal

Add the core operational records for a camp year: configurable camp settings, age groups, campers, workers, and dorm leaders. This gives admins a complete data-management surface even before public registration exists.

## Agent Tasks

- [ ] Add database schema and migrations for camp configuration, age group definitions, campers, workers, and dorm leaders.
- [ ] Implement super-admin screens for camp name, year, camp dates, capacity, registration windows, fee schedule placeholders, discount tier placeholders, and age group definitions.
- [ ] Add admin CRUD screens and API endpoints for campers, workers, and dorm leaders.
- [ ] Support camper fields needed for camp operations, including identity, date of birth, gender, guardian contact, medical notes, dietary restrictions, emergency contact, payment status, QR token, dorm assignment, check-in status, and import source.
- [ ] Support worker fields needed for operations, including contact details, gender, task preferences when available, t-shirt size when available, dorm assignment, check-in status, and import source.
- [ ] Support dorm leader fields, including name, gender, contact info, role, camper-dorm assignment, and check-in status.
- [ ] Enforce role permissions so super admins manage global configuration while camp admins can manage operational records according to the spec.
- [ ] Add capacity count logic for current camper totals and show warnings or blocks according to the confirmed decision.
- [ ] Add tests for configuration validation, age group calculations, person CRUD, and permission boundaries.

## Verification

- [ ] Run database migrations or schema generation successfully.
- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Manually create a camp configuration, age groups, a camper, a worker, and a dorm leader through the admin UI.
- [ ] Manually verify camp admins cannot change super-admin-only configuration if the UI exposes restricted settings.

## Completion Criteria

- [ ] Camp staff can manage the camp-year settings required by later dorm, import, check-in, and registration work.
- [ ] Campers, workers, and dorm leaders can be created, edited, listed, and archived or removed according to local project conventions.
- [ ] Data fields required for Phase 1 camp operations are persisted and available through protected APIs.
