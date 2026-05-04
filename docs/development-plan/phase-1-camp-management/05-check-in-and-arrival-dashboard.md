# Step 05: Check-In and Arrival Dashboard

## Human Tasks Required

**Product decisions (confirmed — no longer blocking):**

- Check-in confirmation email (sent to the camper’s parent/guardian) must include: **camper full name**, **dorm assignment** (building/room label as shown in admin), and **date and time of check-in** (same instant as persisted on the camper, e.g. `checked_in_at`).
- **Local development** must send through **[SendGrid](https://sendgrid.com)** (not only console logging), so delivery is realistic and visible in SendGrid **Activity** (and in the recipient mailbox). Optional: keep a `log` or `disabled` transport for CI/tests without credentials.

**SendGrid setup (you do this before re-running the build step for email work):**

The implementation will use **SMTP** against SendGrid’s relay ([SMTP relay docs](https://docs.sendgrid.com/for-developers/sending-email/getting-started-smtp)).

1. Create or sign in to a **Twilio SendGrid** account.
2. **Sender authentication**: complete **Single Sender Verification** (quickest for dev) or **Domain Authentication** (closer to production). The address or domain you verify must match what you put in `EMAIL_FROM`.
3. **API key**: Settings → **API Keys** → create a key with permission to send mail (e.g. “Restricted Access” with **Mail Send**). Treat it like a password.
4. **SMTP credentials** (fixed for SendGrid; the secret is the API key):
   - Host: `smtp.sendgrid.net`
   - Port: `587` (recommended) or `465`
   - Username: the literal string **`apikey`**
   - Password: your **API key** (not your SendGrid login password)
5. Copy host, port, username, password, and your chosen **`EMAIL_FROM`** into `server/.env` when the agent adds the variables (see **Environment variables for email** below). Do not commit real secrets.

**Note:** SendGrid delivers **real** email to the guardian address on check-in. For local testing, use campers whose `guardianEmail` is an address you control, or watch **Activity** in the SendGrid dashboard for bounces and drops.

**Environment variables for email** (to be documented in `server/.env.example` when implemented):

| Variable          | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `EMAIL_TRANSPORT` | `smtp` for SendGrid (or any SMTP relay); `log` (or similar) for tests/CI without network |
| `SMTP_HOST`       | e.g. `smtp.sendgrid.net`                                                                 |
| `SMTP_PORT`       | e.g. `587`                                                                               |
| `SMTP_USER`       | For SendGrid: always `apikey`                                                            |
| `SMTP_PASS`       | For SendGrid: API key with Mail Send                                                     |
| `EMAIL_FROM`      | Verified sender (must match SendGrid single sender or domain auth)                       |

Other SMTP providers can reuse the same variables with their own host, port, user, and password.

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
- [ ] Send or queue the camper check-in confirmation email after a camper transitions to checked in (guardian address). Body must include **camper full name**, **dorm assignment** (or explicit “unassigned” if none), and **check-in date/time** matching persisted `checked_in_at`, in a readable format. Use **SMTP** (SendGrid relay) when `EMAIL_TRANSPORT=smtp` and credentials are set; use non-network transport (e.g. log) in CI/tests.
- [ ] Add tests for QR lookup, manual search, cash payment updates, duplicate check-in handling, worker check-in, dorm leader check-in, dashboard counts, and email queueing.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] On a phone-sized viewport, scan a camper QR code and complete check-in.
- [ ] Search for a camper without a QR code and complete the same check-in flow.
- [ ] Mark an unpaid camper as paid cash during check-in and confirm dashboard unpaid counts update.
- [ ] Check in a worker and a dorm leader by name search.
- [ ] With SendGrid credentials in `server/.env`, complete a camper check-in and confirm delivery (guardian inbox and/or SendGrid **Activity**) with **name**, **dorm assignment**, and **check-in timestamp**. Confirm CI/tests use non-SMTP transport without requiring secrets.

## Completion Criteria

- [ ] Camp admins can complete arrival-day check-in from mobile and desktop form factors.
- [ ] QR and manual check-in paths reach the same persisted result.
- [ ] Dashboard counts update from real check-in and payment data.
- [ ] Check-in confirmation email is implemented with the confirmed fields; local dev uses SendGrid SMTP when configured; missing SMTP credentials do not crash check-in (degrade gracefully or log per transport design).

## Follow-ups

- Align production SendGrid domain authentication and shared “from” branding with **phase 2** registration-email work and camp ops; this step still expects SendGrid (or compatible SMTP) for local dev delivery.
