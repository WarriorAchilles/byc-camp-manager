# Step 1.05 - Dorm Inventory and Auto-Assignment

## Things for a Human to Complete

- Provide the initial dorm names, capacities, purposes, gender designations, and any known age group assignments.
- Confirm whether initial dorm data should be entered manually through the UI or seeded from a one-time file.
- Confirm the age calculation date used for dorm grouping, such as camp start date or registration date.
- Confirm whether auto-assignment should be triggered manually by an admin or automatically after imports.

## Goal

Create dorm inventory management and automatic assignment rules for camper dorms and worker dorms.

## Agent Implementation Tasks

- Add the dorm data model with purpose, name, gender designation, age group, bed capacity, and assigned dorm leaders.
- Build super admin UI for creating, editing, archiving, and viewing dorms.
- Enforce camper dorm purpose rules: camper dorms are single-gender only and may use camper age groups.
- Enforce worker dorm purpose rules: worker dorms may be boys, girls, or co-ed and do not use camper age groups.
- Implement auto-assignment for campers by gender and configured age group, filling camper dorms up to capacity.
- Implement auto-assignment for workers only into worker dorms.
- Ensure campers are never auto-assigned into worker dorms and workers are never auto-assigned into camper dorms.
- Add tests for assignment ordering, capacity limits, purpose restrictions, gender matching, and age group matching.

## Acceptance Criteria

- Super admins can maintain the full dorm inventory inside the system without depending on an external starting list.
- Auto-assignment places eligible campers into matching camper dorms without exceeding capacity.
- Auto-assignment places workers only into worker dorms.
- Dorm leader assignment is available for camper dorms and not required for worker dorms.
- Invalid dorm configuration combinations are prevented at save time.

## Master Spec References

- [8. Dorm Management](../../specs.md#8-dorm-management) - dorm management feature scope.
- [Dorm Configuration](../../specs.md#dorm-configuration) - dorm purpose, gender designation, age group, capacity, and dorm leader rules.
- [Auto-Assignment](../../specs.md#auto-assignment) - camper and worker auto-assignment behavior.
- [Dorm](../../specs.md#dorm) - dorm data model.
