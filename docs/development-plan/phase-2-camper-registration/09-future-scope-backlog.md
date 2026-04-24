# Step 2.09 - Future Scope Backlog

## Things for a Human to Complete

- Confirm that the listed wish-list items remain out of scope for the initial build.
- Prioritize any wish-list item that should move into Phase 1 or Phase 2 before development begins.
- Provide enough product detail for any promoted item before assigning it to an agent.

## Goal

Capture the spec's future and wish-list items as explicit backlog entries so they are not accidentally implemented or forgotten.

## Agent Implementation Tasks

- Create backlog issues or documentation entries for multi-year support, parent portal, SMS notifications, volunteer management, and waitlist.
- Mark each item as out of scope for the initial two-phase build unless a human explicitly promotes it.
- Add short dependency notes for each item:
  - Multi-year support depends on stable year/season modeling.
  - Parent portal depends on public account/auth decisions.
  - SMS notifications depend on provider choice and consent/compliance handling.
  - Volunteer management depends on worker registration and approval policy.
  - Waitlist depends on final camper capacity behavior.
- Add references from relevant code or docs only where helpful, without building placeholder UI for these features.

## Acceptance Criteria

- Future items are documented in the project backlog.
- No future item is silently included in MVP scope.
- Each future item has a short dependency note and a human decision point.
- The development plan remains focused on Phase 1 camp management and Phase 2 registration.

## Master Spec References

- [13. Future / Wish-List Items](../../specs.md#13-future--wish-list-items) - out-of-scope backlog items and initial-build boundary.
- [Camp Configuration](../../specs.md#camp-configuration) - future multi-year support dependency.
- [Worker Registration Flow](../../specs.md#worker-registration-flow) - future volunteer management dependency.
- [Camp Configuration (Super Admin)](../../specs.md#camp-configuration-super-admin) - future waitlist dependency on capacity behavior.
