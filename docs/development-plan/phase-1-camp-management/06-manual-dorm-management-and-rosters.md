# Step 1.06 - Manual Dorm Management and Rosters

## Things for a Human to Complete

- Confirm whether drag and drop is required for the first release or whether accessible move controls are acceptable alongside drag and drop.
- Confirm any camp policy exceptions that admins commonly need, such as age-group overrides or sibling placement requests.
- Confirm whether dorm rosters should show full medical details or a condensed medical summary.

## Goal

Give camp admins a practical dorm board for manual corrections, exception handling, and per-dorm roster review.

## Agent Implementation Tasks

- Build a responsive dorm management screen with separated camper dorm and worker dorm sections.
- Group or label dorms by purpose and gender designation.
- Show each dorm's occupants, capacity used, remaining capacity, dorm leaders, and warnings.
- Add an unassigned area for campers, workers, and dorm leaders without assignments.
- Implement moving people between dorms with drag and drop or equivalent accessible controls.
- Block or strongly discourage role/purpose violations: campers and dorm leaders only in camper dorms, workers only in worker dorms.
- Warn, but do not prevent, camper dorm age group and gender mismatches.
- Warn for worker gender mismatches in single-gender worker dorms; skip gender warnings for co-ed worker dorms.
- Add detailed dorm roster views with name, age, check-in status, dorm leaders, capacity, and medical notes summary.

## Acceptance Criteria

- Admins can see all assigned and unassigned people on the dorm management screen.
- The UI clearly separates camper dorms from worker dorms.
- Invalid role-to-dorm-purpose moves are blocked or require explicit override if the product chooses to allow override.
- Gender and age group exceptions produce visible warnings without trapping admins.
- Each dorm has a roster view suitable for operational review before printing reports.

## Master Spec References

- [Manual Assignment (Drag and Drop)](../../specs.md#manual-assignment-drag-and-drop) - manual reassignment UI, unassigned area, and validation/warning rules.
- [Dorm Roster View](../../specs.md#dorm-roster-view) - roster contents, capacity, check-in status, leaders, and medical notes.
- [Dorm Configuration](../../specs.md#dorm-configuration) - camper versus worker dorm purpose and gender rules.
