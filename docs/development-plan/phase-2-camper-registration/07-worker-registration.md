# Step 2.07 - Worker Registration

## Things for a Human to Complete

- Cross-check the current live worker Google Form before release and provide any changed labels, required flags, or option lists.
- Provide worker-facing camp header content: dates, check-in instructions, address, contact phone, and contact email.
- Confirm final informational copy about testimony, pastor recommendation, rules expectations, and appearance standards if still policy.
- Decide whether worker t-shirt selection remains informational or includes payment through Stripe.
- Confirm duplicate matching strategy for worker submissions, such as email plus name plus camp year.

## Goal

Build the public worker registration flow while keeping worker records compatible with Phase 1 worker management, worker dorms, and worker check-in.

## Agent Implementation Tasks

- Build the public worker registration form with configurable header content.
- Collect email, first name, last name, optional date of birth, gender, cell number, alt number, address, church, pastor name, pastor phone, faithfulness/serving response, ranked task preferences, and worker t-shirt size.
- Match legacy option lists for gender, state/province, country text behavior, task choices, and t-shirt sizes.
- Require three distinct ranked task preferences.
- Label Night Watch and Administrative duties as pre-approval required.
- Display legacy task preference guidance about camp need and non-full-time duties.
- Display or email informational content about testimony, pastor recommendation, and rules expectations.
- Create or update a worker record for the camp year based on the human-approved duplicate strategy.
- Send worker confirmation email with a copy of submitted responses.
- Keep worker tuition out of the flow; implement only optional paid worker merchandise if approved.

## Acceptance Criteria

- A worker can register without logging in.
- Required fields and options match the legacy worker form.
- Task preferences must be three distinct choices.
- Worker submissions create or update Phase 1 worker records.
- Worker confirmation email includes a copy of submitted answers and required reminders.
- No worker camp tuition is charged.

## Master Spec References

- [Worker Registration Flow](../../specs.md#worker-registration-flow) - public worker flow and legacy form parity.
- [Collected fields (same semantics as the Google Form)](../../specs.md#collected-fields-same-semantics-as-the-google-form) - worker fields, required flags, and option lists.
- [Task preference choices](../../specs.md#task-preference-choices) - fixed ranked task options.
- [Informational content (not form fields)](../../specs.md#informational-content-not-form-fields) - testimony, pastor recommendation, and rules reminders.
- [Post-worker registration](../../specs.md#postworker-registration) - worker email and worker record creation/update behavior.
- [2. Worker registration confirmation](../../specs.md#2-worker-registration-confirmation) - worker email requirements.
- [Worker (volunteer / staff)](../../specs.md#worker-volunteer--staff) - worker data model.
