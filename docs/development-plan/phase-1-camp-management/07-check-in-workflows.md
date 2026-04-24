# Step 1.07 - Check-In Workflows

## Things for a Human to Complete

- Confirm whether phone camera scanning, laptop webcam scanning, or both must be supported in the first release.
- Confirm the wording admins should see when a camper has unpaid cash due.
- Confirm whether check-in can be reversed by camp admins, super admins only, or not at all.
- Confirm operational policy for workers or dorm leaders who arrive without a dorm assignment.

## Goal

Build mobile-friendly check-in for campers, workers, and dorm leaders, including QR scanning, manual lookup, unpaid payment prompts, dorm assignment display, and real-time arrival totals.

## Agent Implementation Tasks

- Build a responsive check-in screen optimized for phones and laptops.
- Add QR scanning for camper QR tokens using device camera or webcam.
- Add manual name search for campers, workers, and dorm leaders.
- Show camper name, dorm assignment, payment status, medical/special-needs flags, and check-in status before confirmation.
- For unpaid camper registrations, prominently prompt admins to collect cash and mark the family registration or camper payment status as paid according to the data model chosen in earlier steps.
- Show worker and dorm leader dorm assignments during check-in.
- Record check-in status and timestamp for campers, workers, and dorm leaders.
- Add a dashboard summary for total registered vs. checked in, worker/dorm leader expected vs. checked in, and unpaid registrations remaining.
- Add tests for QR lookup, manual lookup, duplicate check-in handling, and unpaid payment handling.

## Acceptance Criteria

- A camper can be checked in by scanning a valid QR code.
- A camper, worker, or dorm leader can be checked in by manual name search.
- The check-in confirmation screen shows enough information for an admin to direct the person to the correct dorm.
- Unpaid registrations are visible before check-in is finalized.
- Check-in totals update after successful check-in.
- The flow remains usable on a phone-width viewport.

## Master Spec References

- [7. Check-In](../../specs.md#7-check-in) - check-in feature scope.
- [QR Code Check-In](../../specs.md#qr-code-check-in) - scanner flow, camper lookup, payment status, medical flags, and confirmation.
- [Manual Check-In (No QR Code)](../../specs.md#manual-check-in-no-qr-code) - name search fallback.
- [Worker & Dorm Leader Check-In](../../specs.md#worker--dorm-leader-check-in) - worker and dorm leader arrival handling.
- [Check-In Dashboard](../../specs.md#check-in-dashboard) - real-time arrival and unpaid summary.
- [Cash Payments](../../specs.md#cash-payments) - collecting and marking cash payments during check-in.
