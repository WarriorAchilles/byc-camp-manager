# Step 01: Registration Availability and Public Shell

## Human Tasks Required

- [ ] Provide public-facing camp header copy for camper registration and worker registration, including dates, venue address, check-in instructions, contacts, and any policy notices.
- [ ] Confirm whether countdown timers are required for launch or whether closed registration messages are sufficient.
- [ ] Provide the registration and admin/check-in hostnames for local, staging, and production environments.
- [ ] Confirm whether each registration flow needs a close date/time, a manual enabled/disabled control, or both, and define what an unset opening time means.
- [ ] Confirm how the public registration camp year is selected; do not assume the Phase 1 staff-default camp year should control public registration.

## Spec References

- `docs/specs.md` - "4. Registration System"
- `docs/specs.md` - "Registration Form Availability"
- `docs/specs.md` - "Camp Configuration (Super Admin)"
- `docs/specs.md` - "Key Technical Considerations"
- `docs/specs.md` - "Camp Configuration"

## Goal

Create the public registration entry points and availability controls for both camper family registration and worker registration on a registration subdomain separate from the admin/check-in origin, without yet implementing the full form submissions.

## Agent Tasks

- [ ] Define separate, validated configuration values for the registration public origin and the admin/check-in public origin; use the registration origin for registration routes and later Stripe redirects, and reserve the check-in origin for the camp's posted self-check-in QR destination.
- [ ] Configure host and CORS allowlists for both trusted origins without using permissive production CORS behavior.
- [ ] Ensure the registration host renders only the public registration experience and does not render admin, staff check-in, or self-check-in pages; preserve the existing admin/check-in behavior on its own origin.
- [ ] Decide and implement an explicit public-registration camp-year selector, such as a dedicated setting or public-safe year slug, independently of the Phase 1 staff-default selection.
- [ ] Finish the existing camp-year configuration UI so super admins can edit the already-modeled family and worker opening times.
- [ ] Add any approved close-time or manual enabled/disabled configuration and expose the configurable public header and closed-state content.
- [ ] Add public, unauthenticated, read-only availability endpoints for family camper registration and worker registration that return only the public-safe camp fields needed by the shells.
- [ ] Add browser routes for family camper registration and worker registration on the registration host.
- [ ] Read each route's availability from camp configuration using server time as authoritative.
- [ ] Show a configurable closed-state message or countdown before each route opens.
- [ ] Transition from countdown to live form shell without requiring a full page refresh if countdowns are implemented.
- [ ] Enforce the configured camper capacity on the family registration route and show a clear capacity-reached message when public submissions are blocked.
- [ ] Keep worker registration availability separate from family camper registration availability.
- [ ] Render configurable camp header content on each public registration shell.
- [ ] Ensure public registration shells are responsive and accessible on mobile and desktop.
- [ ] Establish the end-to-end test framework and repository command needed by all later Phase 2 steps.
- [ ] Add baseline public-route protections now, including request-size limits, rate limiting, safe proxy/IP configuration, strict validation, and generic errors that do not expose internal data.
- [ ] Add tests for origin/host isolation, public camp-year selection, open and closed windows, null configuration, countdown state, separate camper and worker gates, and camper capacity blocking.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Configure future open times and confirm each public route shows the closed or countdown state.
- [ ] Configure past open times and confirm each public route shows the appropriate live form shell.
- [ ] Set camper capacity equal to the current camper count and confirm the family registration route refuses new camper submissions.
- [ ] Open the registration hostname and confirm admin/check-in browser routes are unavailable there.
- [ ] Open the admin/check-in hostname and confirm existing admin and check-in routes still work there.
- [ ] Confirm generated registration links use the registration origin and do not use the admin/check-in origin.

## Completion Criteria

- [ ] Public camper and worker registration routes exist and are independently gated by configuration.
- [ ] Camper capacity blocks new public camper submissions when configured and reached.
- [ ] Public shells display camp-specific content and meet baseline responsive accessibility expectations.
- [ ] Registration and admin/check-in browser surfaces are isolated to their configured origins while continuing to share the existing API and database safely.
- [ ] Later Phase 2 steps can add end-to-end scenarios to an established test command.
