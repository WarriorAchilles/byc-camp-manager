# Step 01: Registration Availability and Public Shell

## Human Tasks Required

- [ ] Provide public-facing camp header copy for camper registration and worker registration, including dates, venue address, check-in instructions, contacts, and any policy notices.
- [ ] Confirm whether countdown timers are required for launch or whether closed registration messages are sufficient.

## Spec References

- `docs/specs.md` - "4. Registration System"
- `docs/specs.md` - "Registration Form Availability"
- `docs/specs.md` - "Camp Configuration (Super Admin)"
- `docs/specs.md` - "Key Technical Considerations"
- `docs/specs.md` - "Camp Configuration"

## Goal

Create the public registration entry points and availability controls for both camper family registration and worker registration, without yet implementing the full form submissions.

## Agent Tasks

- [ ] Add public routes for family camper registration and worker registration.
- [ ] Read each route's open date and time from camp configuration.
- [ ] Show a configurable closed-state message or countdown before each route opens.
- [ ] Transition from countdown to live form shell without requiring a full page refresh if countdowns are implemented.
- [ ] Enforce the configured camper capacity on the family registration route and show a clear capacity-reached message when public submissions are blocked.
- [ ] Keep worker registration availability separate from family camper registration availability.
- [ ] Render configurable camp header content on each public registration shell.
- [ ] Ensure public registration shells are responsive and accessible on mobile and desktop.
- [ ] Add tests for open windows, closed windows, countdown state, separate camper and worker gates, and camper capacity blocking.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Configure future open times and confirm each public route shows the closed or countdown state.
- [ ] Configure past open times and confirm each public route shows the appropriate live form shell.
- [ ] Set camper capacity equal to the current camper count and confirm the family registration route refuses new camper submissions.

## Completion Criteria

- [ ] Public camper and worker registration routes exist and are independently gated by configuration.
- [ ] Camper capacity blocks new public camper submissions when configured and reached.
- [ ] Public shells display camp-specific content and meet baseline responsive accessibility expectations.
