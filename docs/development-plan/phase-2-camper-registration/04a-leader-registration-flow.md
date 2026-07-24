# Step 04a: Leader Registration Flow

## Source

- `docs/specs.md` - "Leader Registration Flow"
- Historical `Leader Form - BYC 2026 (Responses)` CSV supplied for field parity

## Goal

Provide a separate public dorm-leader registration flow that captures the historical leader form fields and creates operational dorm-leader records without conflating leaders with workers.

## Agent Tasks

- [x] Add an independently configurable leader registration availability window, header, and closed message.
- [x] Add a public `/register/leader` route and navigation from the other registration flows.
- [x] Capture identity, date of birth, gender, phones, address, marital status, faith/church details, preferred age group, and optional T-shirt size.
- [x] Create an online-registration dorm-leader record compatible with dorm assignment and check-in.
- [x] Add idempotent retry handling and reject likely duplicate leaders without overwriting existing records.
- [x] Add server contract/integration tests and a client confirmation test.

## Verification

- [ ] Apply the Prisma migration in the target environment.
- [ ] Run repository lint, typecheck, and tests.
- [ ] Enable leader registration for a camp year and submit the public form.
- [ ] Confirm the leader appears in the admin People page and can be assigned to a camper dorm.

## Completion Criteria

- [x] Leaders have a registration flow separate from workers.
- [x] Every historical CSV field has a persisted destination.
- [x] Public registrations are safe to retry and cannot overwrite an existing leader.
