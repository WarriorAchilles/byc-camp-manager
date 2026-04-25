# Step 04: Dorm Management and Assignment

## Human Tasks Required

- [ ] None.

## Spec References

- `docs/specs.md` - "8. Dorm Management"
- `docs/specs.md` - "Dorm Configuration"
- `docs/specs.md` - "Auto-Assignment"
- `docs/specs.md` - "Manual Assignment (Drag and Drop)"
- `docs/specs.md` - "Dorm Roster View"
- `docs/specs.md` - "Dorm"
- `docs/specs.md` - "Dorm Leader"

## Goal

Build the dorm inventory, assignment rules, auto-assignment workflow, manual drag-and-drop reassignment interface, and per-dorm roster view needed to house campers, workers, and dorm leaders correctly.

## Agent Tasks

- [ ] Add the dorm data model with purpose, name, gender designation, camper age group, capacity, and assigned dorm leaders.
- [ ] Build super-admin CRUD screens for camper dorms and worker dorms.
- [ ] Enforce dorm configuration rules: camper dorms are boys or girls only, worker dorms can be boys, girls, or co-ed, and age groups apply only to camper dorms.
- [ ] Implement auto-assignment for campers based on gender and calculated age group while respecting dorm capacity.
- [ ] Implement auto-assignment for workers only into worker dorms while respecting worker dorm capacity.
- [ ] Keep dorm leaders assigned only to camper dorms.
- [ ] Build a manual assignment UI with separate camper dorm, worker dorm, and unassigned sections.
- [ ] Use drag-and-drop or an accessible equivalent that supports keyboard and screen-reader use.
- [ ] Block invalid role-to-dorm assignments and show warnings for gender or age-group exceptions where the spec allows admin override.
- [ ] Build a per-dorm roster view showing assigned people, age, check-in status, capacity usage, dorm leaders, and medical notes summary.
- [ ] Add tests for assignment eligibility, capacity behavior, auto-assignment ordering, warning cases, and invalid target blocking.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Create camper and worker dorms with different purposes and gender settings.
- [ ] Run auto-assignment and confirm campers and workers are placed only in compatible dorm types.
- [ ] Manually move a camper into an age or gender exception and confirm the UI warns but allows the permitted override.
- [ ] Attempt to place a worker in a camper dorm and confirm the UI and API reject it.
- [ ] Open a dorm roster and confirm capacity, check-in status, dorm leaders, and medical notes render correctly.

## Completion Criteria

- [ ] Admins can configure dorm inventory entirely inside the system.
- [ ] Auto-assignment produces valid initial assignments for campers and workers.
- [ ] Manual reassignment supports operational exceptions without allowing role-to-dorm category mistakes.
- [ ] Dorm rosters are available for review before report export work begins.
