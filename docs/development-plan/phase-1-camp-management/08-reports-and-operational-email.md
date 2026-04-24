# Step 1.08 - Reports and Operational Email

## Things for a Human to Complete

- Confirm which reports beyond the required dorm report are needed for the first release.
- Confirm whether report export should use browser print, server-generated PDF, or both.
- Provide the final check-in confirmation email contents, including whether to include dorm leader name, emergency contact info, or other details.
- Choose and configure the transactional email provider, such as AWS SES or SendGrid.
- Provide verified sender/domain settings and production email credentials outside source control.

## Goal

Deliver printable operational reports and the check-in confirmation email required after camper arrival.

## Agent Implementation Tasks

- Add a reports area in the admin interface.
- Build the required per-dorm roster report with camper name, age, check-in status, parent/guardian name and phone, and medical notes.
- Make reports viewable on screen and printable or PDF-exportable.
- Implement any human-confirmed additional reports from the spec, such as registration summary, financial summary, medical summary, dietary needs, check-in status, emergency contacts, head count, and merchandise order summary.
- Add report filters for camp year, dorm, age group, gender, payment status, check-in status, and role where useful.
- Add transactional email provider integration behind a small internal service.
- Send a parent/guardian check-in confirmation email after camper check-in.
- Store email send status or logs sufficient for debugging failed sends.

## Acceptance Criteria

- The dorm report can be printed and given to dorm leaders.
- Reports use current dorm assignment, check-in, contact, payment, and medical data.
- The check-in email sends after camper check-in and uses the human-approved content.
- Failed email sends are visible to admins or logged with enough detail for support.
- Email credentials and provider-specific secrets are not committed.

## Master Spec References

- [9. Reports](../../specs.md#9-reports) - on-screen, printable, and PDF-exportable reporting requirements.
- [Dorm Report (Required)](../../specs.md#dorm-report-required) - required per-dorm roster fields.
- [Additional Reports (TBD - Examples for Consideration)](../../specs.md#additional-reports-tbd---examples-for-consideration) - optional report candidates and human decision point.
- [10. Email Notifications](../../specs.md#10-email-notifications) - transactional email scope.
- [3. Check-In Confirmation Email](../../specs.md#3-check-in-confirmation-email) - parent email after camper check-in and outstanding content decision.
- [2. Technical Architecture](../../specs.md#2-technical-architecture) - transactional email provider consideration.
