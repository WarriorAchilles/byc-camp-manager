# Step 05: Registration Confirmation Emails

## Human Tasks Required

- [ ] Choose and configure the transactional email provider, sender address, domain authentication, and production credentials.
- [ ] Provide final family registration confirmation copy, worker registration confirmation copy, and camp information content.

## Spec References

- `docs/specs.md` - "10. Email Notifications"
- `docs/specs.md` - "1. Family (camper) registration confirmation"
- `docs/specs.md` - "2. Worker registration confirmation"
- `docs/specs.md` - "Post-Registration"
- `docs/specs.md` - "Post-worker registration"
- `docs/specs.md` - "Informational content (not form fields)"

## Goal

Send transactional confirmation emails for family camper registrations and worker registrations, including QR codes, pricing summaries, submitted responses, and required camp guidance.

## Agent Tasks

- [ ] Add an email delivery abstraction that supports local development logging and the configured production provider.
- [ ] Create a family registration confirmation email template with registration confirmation, registered campers, itemized pricing breakdown, one QR code per camper, merchandise summary, payment status, cash amount due when applicable, camp dates, and relevant camp information.
- [ ] Generate or embed QR code images for each camper in the family confirmation email.
- [ ] Create a worker registration confirmation email template with registration confirmation, a copy of submitted responses, testimony reminder, pastor recommendation reminder, and rules expectations.
- [ ] Send family confirmation emails after successful registration completion according to payment path rules.
- [ ] Send worker confirmation emails immediately after accepted worker submission.
- [ ] Record email send status or delivery attempts for operational troubleshooting.
- [ ] Avoid logging sensitive medical details in application logs while still allowing email troubleshooting.
- [ ] Add tests for template rendering, QR code inclusion, cash payment messaging, worker submitted-response copies, and provider failure handling.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete a paid family registration in test mode and confirm the email includes paid status, itemized pricing, and QR codes.
- [ ] Complete a cash-at-camp family registration and confirm the email prominently shows the exact amount due.
- [ ] Submit a worker registration and confirm the email includes a copy of submitted responses and required reminders.
- [ ] Simulate provider failure and confirm the app records the failed attempt without losing registration data.

## Completion Criteria

- [ ] Family registration confirmations contain the operational details parents need for check-in.
- [ ] Worker registration confirmations provide a Google-Forms-equivalent copy of submitted answers.
- [ ] Email sending is observable and safe to test locally.
