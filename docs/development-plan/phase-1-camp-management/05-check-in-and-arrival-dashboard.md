# Step 05: Check-In and Arrival Dashboard

## Human Tasks Required

**Product decisions (confirmed — no longer blocking):**

- Check-in confirmation email (sent to the camper’s parent/guardian) must include: **camper full name**, **dorm assignment** (building/room label as shown in admin), and **date and time of check-in** (same instant as persisted on the camper, e.g. `checked_in_at`).
- **Local development** must send through **Amazon SES SMTP** (not only console logging), so delivery is realistic and visible in the SES sending metrics and the recipient mailbox. Keep the `log` transport for CI/tests without credentials.

**Amazon SES setup (you do this before re-running the build step for email work):**

The implementation uses **SMTP** against the regional Amazon SES endpoint ([SES SMTP documentation](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html)).

1. Open **Amazon SES** in the AWS region from which the application will send.
2. **Sender authentication**: create and verify a domain identity, publish the generated DKIM DNS records, and use an address covered by that identity for `EMAIL_FROM`.
3. **Production access**: request removal from the SES sandbox before sending to addresses that are not verified SES identities.
4. **SMTP credentials**: generate credentials under SES **SMTP settings**. These credentials are region-specific and are not ordinary AWS access keys.
   - Host: `email-smtp.<region>.amazonaws.com` (for example, `email-smtp.us-east-2.amazonaws.com`)
   - Port: `587` (recommended) or `465`
   - Username: the generated **SES SMTP username**
   - Password: the generated **SES SMTP password**
5. Copy host, port, username, password, and your chosen **`EMAIL_FROM`** into `server/.env` when the agent adds the variables (see **Environment variables for email** below). Do not commit real secrets.

**Note:** SES delivers **real** email to the guardian address on check-in. For local testing, use campers whose `guardianEmail` is an address you control. While the account remains in the SES sandbox, recipients must also be verified identities.

**Environment variables for email** (to be documented in `server/.env.example` when implemented):

| Variable          | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT` | `smtp` for SES delivery; `log` for tests/CI without network                              |
| `SMTP_HOST`       | Regional endpoint, e.g. `email-smtp.us-east-2.amazonaws.com`                            |
| `SMTP_PORT`       | e.g. `587`                                                                               |
| `SMTP_USER`       | Region-specific SES SMTP username                                                        |
| `SMTP_PASS`       | Region-specific SES SMTP password                                                        |
| `EMAIL_FROM`      | Address covered by a verified SES identity in the sending region                        |

The shared Nodemailer transport remains provider-neutral even though Amazon SES is the configured production provider.

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
- [ ] Send or queue the camper check-in confirmation email after a camper transitions to checked in (guardian address). Body must include **camper full name**, **dorm assignment** (or explicit “unassigned” if none), and **check-in date/time** matching persisted `checked_in_at`, in a readable format. Use the **Amazon SES SMTP relay** when `EMAIL_TRANSPORT=smtp` and credentials are set; use the non-network `log` transport in CI/tests.
- [ ] Add tests for QR lookup, manual search, cash payment updates, duplicate check-in handling, worker check-in, dorm leader check-in, dashboard counts, and email queueing.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] On a phone-sized viewport, scan a camper QR code and complete check-in.
- [ ] Search for a camper without a QR code and complete the same check-in flow.
- [ ] Mark an unpaid camper as paid cash during check-in and confirm dashboard unpaid counts update.
- [ ] Check in a worker and a dorm leader by name search.
- [ ] With SES SMTP credentials in `server/.env`, complete a camper check-in and confirm delivery to a controlled guardian inbox with **name**, **dorm assignment**, and **check-in timestamp**. Confirm CI/tests use the non-network transport without requiring secrets.

## Completion Criteria

- [ ] Camp admins can complete arrival-day check-in from mobile and desktop form factors.
- [ ] QR and manual check-in paths reach the same persisted result.
- [ ] Dashboard counts update from real check-in and payment data.
- [ ] Check-in confirmation email is implemented with the confirmed fields; local dev uses Amazon SES SMTP when configured; missing SMTP credentials do not crash check-in (degrade gracefully or log per transport design).

## Follow-ups

- Align the production SES domain identity, DKIM configuration, and shared “from” branding with **phase 2** registration-email work and camp operations.
