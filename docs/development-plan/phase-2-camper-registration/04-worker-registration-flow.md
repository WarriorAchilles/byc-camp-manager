# Step 04: Worker Registration Flow

## Human Tasks Required

- [ ] Cross-check the live legacy worker Google Form before release and provide any field, option, or copy changes not already captured in the spec.
- [ ] Confirm final informational copy for testimony, pastor recommendation, and camp rules expectations.
- [ ] Confirm worker t-shirt payment remains informational for this step unless a later payment scope is approved.
- [ ] Choose the public worker duplicate policy before implementation. Prefer creating a reviewable submission and flagging likely matches unless stakeholders approve a sufficiently strong exact-match update rule; email alone must not authorize overwriting an existing worker.

## Spec References

- `docs/specs.md` - "Worker Registration Flow"
- `docs/specs.md` - "Collected fields (same semantics as the Google Form)"
- `docs/specs.md` - "Informational content (not form fields)"
- `docs/specs.md` - "Post-worker registration"
- `docs/specs.md` - "Worker registration and money"
- `docs/specs.md` - "Worker (volunteer / staff)"

## Goal

Implement the public worker registration form with legacy Google Form parity, safe duplicate handling, and no camp tuition payment requirement.

## Agent Tasks

- [ ] Build the public worker registration form behind the worker registration availability gate.
- [ ] Display configurable camp header content equivalent to the legacy worker form.
- [ ] Capture worker email, first name, last name, optional date of birth, gender, cell number, alternate number, address fields, faith-serving response, church, pastor name, pastor phone, ranked task preferences, and worker t-shirt size.
- [ ] Match legacy option lists for gender, state or province, task preferences, pre-approval labels, and worker t-shirt sizes.
- [ ] Require three distinct ranked task preferences.
- [ ] Display the legacy guidance that task assignments depend on camp need and that some preferences are not full-time duties.
- [ ] Display informational content about written testimony, pastor recommendation, and camp rules expectations on confirmation and/or email surfaces.
- [ ] Apply the approved duplicate policy using the Step 00 indexes and provenance model; never silently overwrite an existing worker based only on an unauthenticated email submission.
- [ ] If duplicate review is chosen, persist the new submission and surface likely matches to authorized admins without making it available to operational workflows until resolved.
- [ ] Persist provenance, submission timestamp, and optional IP address for abuse prevention.
- [ ] Keep worker camp tuition payment out of this flow.
- [ ] Apply the public-route request-size, rate-limit, validation, idempotency, and safe-IP rules established in Step 01.
- [ ] Add tests for required fields, option lists, distinct task rankings, idempotent retries, approved duplicate behavior, protection against email-only overwrite, worker record persistence, and informational content display.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Submit a valid worker registration and confirm a worker record appears in the admin people list.
- [ ] Attempt to choose the same task preference more than once and confirm validation blocks submission.
- [ ] Submit a repeat worker registration according to the confirmed matching strategy and confirm the system updates or flags the existing worker instead of silently duplicating.
- [ ] Submit an existing worker's email with different identity details and confirm the public request cannot overwrite the existing worker.
- [ ] Confirm no camp tuition payment is requested from workers.

## Completion Criteria

- [ ] Workers can register publicly without an admin account.
- [ ] Worker form fields and options match the legacy intake requirements.
- [ ] Worker records created by registration can be used by Phase 1 dorm assignment and check-in workflows.
- [ ] Worker payment scope is intentionally limited to the confirmed policy.
- [ ] Duplicate handling is explicit, auditable, and safe for an unauthenticated public flow.
