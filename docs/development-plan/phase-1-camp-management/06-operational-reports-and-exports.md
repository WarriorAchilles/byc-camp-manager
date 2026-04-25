# Step 06: Operational Reports and Exports

## Human Tasks Required

- [ ] Confirm which proposed reports beyond the required dorm report must ship in the first operations release.
- [ ] Confirm whether PDF export must be server-rendered, browser print-to-PDF, or either approach.

## Spec References

- `docs/specs.md` - "9. Reports"
- `docs/specs.md` - "Dorm Report (Required)"
- `docs/specs.md` - "Additional Reports (TBD - Examples for Consideration)"
- `docs/specs.md` - "Dorm Roster View"
- `docs/specs.md` - "Outstanding Items & TBD Questions"

## Goal

Provide printable and exportable operational reports, starting with the required per-dorm roster and then adding confirmed summary reports that camp admins need for camp week.

## Agent Tasks

- [ ] Build the required per-dorm report with camper name, age, check-in status, parent or guardian name, parent or guardian phone, allergies, medications, and other medical notes.
- [ ] Include dorm leader names and dorm capacity context on printed dorm reports when available.
- [ ] Add print-friendly styling and PDF export behavior for report pages.
- [ ] Add filters or selectors for camp year, dorm, gender, age group, and check-in status where useful.
- [ ] Implement confirmed additional reports from the TBD list, prioritizing operational value and data already available in Phase 1.
- [ ] If additional report requirements remain undecided, create clear placeholders or documentation rather than guessing hidden product scope.
- [ ] Add tests for report data queries, permission checks, and print/export rendering where the stack supports it.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Generate a dorm report for a dorm with checked-in and not-yet-arrived campers.
- [ ] Print or export the dorm report and confirm the output is readable without admin navigation chrome.
- [ ] Generate each confirmed additional report and compare totals against seed or test data.

## Completion Criteria

- [ ] Dorm leaders can receive a printed or PDF dorm roster with the required fields.
- [ ] Camp admins can view reports on screen and export them for camp operations.
- [ ] Any reports not implemented are documented as intentionally deferred with the decision owner named.
