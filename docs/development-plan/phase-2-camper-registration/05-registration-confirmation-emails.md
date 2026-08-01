# Step 05: Registration Confirmation Emails

## Human Tasks Required

- [ ] Configure **Amazon SES** for registration email delivery in the selected AWS region. Reuse the verified domain identity and region-specific SMTP credentials used for check-in confirmation email, or create production-specific SES SMTP credentials. Request production access before sending to unverified recipients, and never commit the credentials.
- [ ] Provide final family registration confirmation copy, worker registration confirmation copy, and camp information content.
- [ ] Confirm the final registration and admin/check-in public hostnames so ordinary email links point to the correct origins; the camp self-check-in URL itself remains limited to the QR code posted at the physical check-in location.

## Amazon SES Implementation Reference

Registration confirmations must use the same **Nodemailer + Amazon SES SMTP relay** implementation already used for camper check-in confirmations; do not introduce the AWS SDK or a second transport/configuration path.

- Existing implementation: `server/src/lib/checkInConfirmationMail.ts`
- Existing implementation plan and Amazon SES setup: `docs/development-plan/phase-1-camp-management/05-check-in-and-arrival-dashboard.md`
- Existing configuration example: `server/.env.example`
- Amazon SES SMTP settings: regional host `email-smtp.<region>.amazonaws.com`, port `587` (STARTTLS; use `465` only when implicit TLS is intentionally configured), and region-specific SES SMTP credentials generated under SES **SMTP settings**.
- `EMAIL_FROM` must be covered by a verified SES email or domain identity in the sending region.
- Continue to use `EMAIL_TRANSPORT=smtp` for real SES delivery and the non-network `log` transport for automated tests/CI. The log transport must emit safe metadata only.
- Reuse the existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, and `EMAIL_TRANSPORT` variables. Do not add a second set of registration-only SES credentials unless an operational requirement is documented later.

## Spec References

- `docs/specs.md` - "10. Email Notifications"
- `docs/specs.md` - "1. Family (camper) registration confirmation"
- `docs/specs.md` - "2. Worker registration confirmation"
- `docs/specs.md` - "Post-Registration"
- `docs/specs.md` - "Post-worker registration"
- `docs/specs.md` - "Informational content (not form fields)"

## Goal

Send family camper, worker, and leader registration confirmation emails through Amazon SES, including pricing summaries, submitted responses, and required camp guidance. Registrants do not receive personal QR codes; they scan the camp's posted self-check-in QR code after arriving at the physical check-in location.

## Agent Tasks

- [ ] Extract the Nodemailer transport/configuration and safe result handling from `server/src/lib/checkInConfirmationMail.ts` into a shared email delivery service. Keep Amazon SES SMTP as the real-delivery provider and preserve the existing `EMAIL_TRANSPORT=smtp|log` contract rather than creating a second transport abstraction or using the AWS SDK.
- [ ] Refactor check-in confirmation email to use the shared service without changing its trigger, recipient, content, graceful-failure behavior, or existing SES configuration.
- [ ] Send registration confirmations through that shared SES-backed service using both plain-text and HTML bodies. Capture the provider/message identifier returned by Nodemailer when available, but do not expose it or any credentials to the public client.
- [ ] Update `server/.env.example` and `docs/deployment.md` so the shared Amazon SES SMTP variables are documented for check-in and registration confirmation emails.
- [ ] Change development/log delivery so it records safe metadata and status only; do not log recipient addresses, full message bodies, medical data, legal agreement data, or worker submitted responses.
- [ ] Create a family registration confirmation email template with registration confirmation, registered campers, itemized pricing breakdown, merchandise summary, payment status, cash amount due when applicable, camp dates, relevant camp information, and instructions to scan the posted self-check-in QR code after arriving.
- [ ] Do not include or attach an individual camper QR code, the camp self-check-in QR code, or the self-check-in URL in registration emails.
- [ ] Create a worker registration confirmation email template with registration confirmation, a copy of submitted responses, testimony reminder, pastor recommendation reminder, rules expectations, and instructions to scan the posted self-check-in QR code after arriving; do not include the QR code or its URL.
- [ ] Create a leader registration confirmation email template with registration confirmation, a copy of submitted responses, camp and T-shirt guidance, and instructions to scan the posted self-check-in QR code after arriving; do not include the QR code or its URL.
- [ ] Send family confirmation emails only after the Step 00 lifecycle reaches the approved confirmed state: after verified Stripe payment, or immediately after confirmed cash-at-camp selection.
- [ ] Send worker confirmation emails immediately after accepted worker submission.
- [ ] Send leader confirmation emails immediately after accepted leader submission.
- [ ] Record durable email send status or delivery attempts for operational troubleshooting and make retries idempotent so a webhook replay does not send duplicate confirmations.
- [ ] Add tests for template rendering, absence of camper and camp self-check-in QR codes/URLs, on-site self-check-in instructions, cash payment messaging, worker submitted-response copies, log redaction, duplicate-trigger suppression, and provider failure handling.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] With `EMAIL_TRANSPORT=smtp` and SES SMTP variables configured in `server/.env`, complete a paid family registration in Stripe test mode and confirm the email arrives in a controlled inbox. Confirm it includes paid status and itemized pricing but no personal or camp self-check-in QR code/URL.
- [ ] Complete a cash-at-camp family registration and confirm the email prominently shows the exact amount due.
- [ ] Submit a worker registration and confirm through a controlled inbox that the email includes a copy of submitted responses, required reminders, and on-site posted-QR instructions without exposing the QR code or URL.
- [ ] Complete a camper check-in after the shared-service refactor and confirm the existing check-in confirmation still sends through SES with the expected camper, dorm, and check-in-time content.
- [ ] Run automated tests with `EMAIL_TRANSPORT=log` and no SES credentials; confirm no test attempts a network send and logs contain safe metadata only.
- [ ] Simulate provider failure and confirm the app records the failed attempt without losing registration data.
- [ ] Inspect development and production-style logs and confirm they contain no recipient address, full message body, medical information, legal signature data, or worker response copy.
- [ ] Replay a payment completion event and confirm only one family registration confirmation is sent.

## Completion Criteria

- [ ] Family registration confirmations contain the operational details parents need for check-in.
- [ ] Worker registration confirmations provide a Google-Forms-equivalent copy of submitted answers.
- [ ] All real check-in and registration confirmation delivery uses the shared Nodemailer transport configured for Amazon SES SMTP; automated tests/CI may use the non-network log transport.
- [ ] SES sending metrics and application delivery-attempt records provide operational visibility, delivery failures are recorded without losing registration data, and local/test logs do not expose sensitive content.
- [ ] Ordinary registration links stay on the registration origin, and confirmation emails direct attendees to scan the QR code posted at physical check-in without exposing its admin/check-in URL.
