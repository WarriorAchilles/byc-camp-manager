# Step 2.06 - Registration Confirmation, QR Codes, and Email

## Things for a Human to Complete

- Provide final family registration confirmation email copy, including camp information and what-to-bring details.
- Confirm whether QR codes should be embedded in email, attached as images/PDF, or both.
- Confirm whether a parent receives one combined family email only or one family email plus per-camper attachments.
- Confirm the sender address and transactional email provider settings if not already completed in Phase 1.

## Goal

Finalize successful family registration by creating camper QR codes and sending a complete confirmation email.

## Agent Implementation Tasks

- Generate a unique QR code token for each registered camper.
- Render QR codes for display on the confirmation page and email.
- Send the parent/guardian a family registration confirmation email immediately after successful submission or successful Stripe payment, depending on payment method.
- Include registered campers, full itemized pricing breakdown, one QR code per camper, merchandise summary, payment status, camp dates, and relevant camp information.
- For cash-at-camp registrations, prominently repeat the exact amount due at check-in.
- Ensure generated QR tokens work with the Phase 1 check-in scanner.
- Add resend support for admins if confirmation email delivery fails or a parent requests another copy.

## Acceptance Criteria

- Every registered camper receives a unique QR code.
- The confirmation email contains all required registration, pricing, payment, merchandise, and QR information.
- Cash-at-camp confirmation clearly states the unpaid total due.
- QR codes generated during registration can be used for check-in.
- Admins can identify whether a confirmation email was sent successfully.

## Master Spec References

- [Post-Registration](../../specs.md#post-registration) - camper QR codes and parent confirmation email contents.
- [1. Family (camper) registration confirmation](../../specs.md#1-family-camper-registration-confirmation) - family registration email requirements.
- [Step 5 - Payment](../../specs.md#step-5---payment) - confirmation screen and payment status messaging.
- [10. Email Notifications](../../specs.md#10-email-notifications) - transactional email scope.
- [2. Technical Architecture](../../specs.md#2-technical-architecture) - QR code and email technical considerations.
