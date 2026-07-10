# Step 05: Registration Confirmation Emails

## Human Tasks Required

- [ ] Choose and configure the transactional email provider, sender address, domain authentication, and production credentials.
- [ ] Provide final family registration confirmation copy, worker registration confirmation copy, and camp information content.
- [ ] Confirm the final registration and admin/check-in public hostnames so ordinary email links point to the correct origins; the camp self-check-in URL itself remains limited to the QR code posted at the physical check-in location.

## Spec References

- `docs/specs.md` - "10. Email Notifications"
- `docs/specs.md` - "1. Family (camper) registration confirmation"
- `docs/specs.md` - "2. Worker registration confirmation"
- `docs/specs.md` - "Post-Registration"
- `docs/specs.md` - "Post-worker registration"
- `docs/specs.md` - "Informational content (not form fields)"

## Goal

Send transactional confirmation emails for family camper registrations and worker registrations, including pricing summaries, submitted responses, and required camp guidance. Registrants do not receive personal QR codes; they scan the camp's posted self-check-in QR code after arriving at the physical check-in location.

## Agent Tasks

- [ ] Extract the existing Nodemailer/log check-in mail code into a shared email delivery service rather than creating a second transport abstraction.
- [ ] Preserve existing check-in confirmation behavior while allowing registration-specific templates and delivery-attempt records.
- [ ] Change development/log delivery so it records safe metadata and status only; do not log recipient addresses, full message bodies, medical data, legal agreement data, or worker submitted responses.
- [ ] Create a family registration confirmation email template with registration confirmation, registered campers, itemized pricing breakdown, merchandise summary, payment status, cash amount due when applicable, camp dates, relevant camp information, and instructions to scan the posted self-check-in QR code after arriving.
- [ ] Do not include or attach an individual camper QR code, the camp self-check-in QR code, or the self-check-in URL in registration emails.
- [ ] Create a worker registration confirmation email template with registration confirmation, a copy of submitted responses, testimony reminder, pastor recommendation reminder, rules expectations, and instructions to scan the posted self-check-in QR code after arriving; do not include the QR code or its URL.
- [ ] Send family confirmation emails only after the Step 00 lifecycle reaches the approved confirmed state: after verified Stripe payment, or immediately after confirmed cash-at-camp selection.
- [ ] Send worker confirmation emails immediately after accepted worker submission.
- [ ] Record durable email send status or delivery attempts for operational troubleshooting and make retries idempotent so a webhook replay does not send duplicate confirmations.
- [ ] Add tests for template rendering, absence of camper and camp self-check-in QR codes/URLs, on-site self-check-in instructions, cash payment messaging, worker submitted-response copies, log redaction, duplicate-trigger suppression, and provider failure handling.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete a paid family registration in test mode and confirm the email includes paid status and itemized pricing but no personal or camp self-check-in QR code/URL.
- [ ] Complete a cash-at-camp family registration and confirm the email prominently shows the exact amount due.
- [ ] Submit a worker registration and confirm the email includes a copy of submitted responses, required reminders, and on-site posted-QR instructions without exposing the QR code or URL.
- [ ] Simulate provider failure and confirm the app records the failed attempt without losing registration data.
- [ ] Inspect development and production-style logs and confirm they contain no recipient address, full message body, medical information, legal signature data, or worker response copy.
- [ ] Replay a payment completion event and confirm only one family registration confirmation is sent.

## Completion Criteria

- [ ] Family registration confirmations contain the operational details parents need for check-in.
- [ ] Worker registration confirmations provide a Google-Forms-equivalent copy of submitted answers.
- [ ] Email sending is observable and safe to test locally.
- [ ] Ordinary registration links stay on the registration origin, and confirmation emails direct attendees to scan the QR code posted at physical check-in without exposing its admin/check-in URL.
