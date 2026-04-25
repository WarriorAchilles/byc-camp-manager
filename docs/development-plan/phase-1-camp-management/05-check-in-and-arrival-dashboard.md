# Step 05: Check-In and Arrival Dashboard

## Human Tasks Required

- [ ] Confirm final check-in confirmation email content beyond camper name and dorm assignment.
- [ ] Confirm whether local development should use a sandbox email provider, logged email output, or both.

## Spec References

- `docs/specs.md` - "7. Check-In"
- `docs/specs.md` - "QR Code Check-In"
- `docs/specs.md` - "Manual Check-In (No QR Code)"
- `docs/specs.md` - "Worker & Dorm Leader Check-In"
- `docs/specs.md` - "Check-In Dashboard"
- `docs/specs.md` - "Cash Payments"
- `docs/specs.md` - "10. Email Notifications"
- `docs/specs.md` - "3. Check-In Confirmation Email"
- `docs/specs.md` - "Camper"
- `docs/specs.md` - "Worker (volunteer / staff)"
- `docs/specs.md` - "Dorm Leader"

## Goal

Deliver the arrival-day workflow for camp admins: scan or search attendees, review assignment and payment context, mark check-in, collect cash when needed, and monitor live arrival progress.

## Agent Tasks

- [ ] Add QR token lookup endpoints and ensure imported/admin-created campers have unique QR tokens.
- [ ] Build a mobile-friendly check-in screen that can use a device camera or webcam for QR scanning.
- [ ] Add manual camper search by name for cases where the QR code is missing.
- [ ] Show camper name, dorm assignment, payment status, medical notes, dietary or special-needs flags, and check-in status before confirmation.
- [ ] Allow admins to mark a family registration or imported camper payment as paid cash when collecting payment at camp.
- [ ] Add worker and dorm leader check-in by name search, including dorm assignment display.
- [ ] Persist check-in status and timestamp for campers, workers, and dorm leaders.
- [ ] Build a check-in dashboard showing registered versus checked-in campers, registered versus checked-in workers and dorm leaders, and unpaid registrations remaining.
- [ ] Send or queue the camper check-in confirmation email after check-in using the confirmed content.
- [ ] Add tests for QR lookup, manual search, cash payment updates, duplicate check-in handling, worker check-in, dorm leader check-in, dashboard counts, and email queueing.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] On a phone-sized viewport, scan a camper QR code and complete check-in.
- [ ] Search for a camper without a QR code and complete the same check-in flow.
- [ ] Mark an unpaid camper as paid cash during check-in and confirm dashboard unpaid counts update.
- [ ] Check in a worker and a dorm leader by name search.
- [ ] Confirm the check-in confirmation email is sent, queued, or logged according to the environment.

## Completion Criteria

- [ ] Camp admins can complete arrival-day check-in from mobile and desktop form factors.
- [ ] QR and manual check-in paths reach the same persisted result.
- [ ] Dashboard counts update from real check-in and payment data.
- [ ] Check-in confirmation email behavior is implemented or explicitly blocked by a missing human-owned provider setup.
