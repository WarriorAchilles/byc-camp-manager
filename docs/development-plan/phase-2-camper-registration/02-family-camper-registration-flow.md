# Step 02: Family Camper Registration Flow

## Human Tasks Required

- [ ] Provide final medical release and liability waiver text.
- [ ] Confirm whether typed legal signature, drawn signature, or both are required.
- [ ] Cross-check the live legacy camper Google Form before release and provide any field or option changes not already captured in the spec.

## Spec References

- `docs/specs.md` - "Family Registration Flow"
- `docs/specs.md` - "Step 1 - Parent / Guardian Information"
- `docs/specs.md` - "Step 2 - Camper Information (repeatable for each child)"
- `docs/specs.md` - "Step 3 - Medical Release & Legal Agreement"
- `docs/specs.md` - "Camper fields (legacy parity)"
- `docs/specs.md` - "Family Registration"
- `docs/specs.md` - "Camper"

## Goal

Implement the public family registration form through parent information, repeatable camper information, and medical release capture, while preserving legacy camper-form field parity and the lifecycle defined in Step 00.

## Agent Tasks

- [ ] Add an entry screen that branches between an adult camper registering themselves and a parent/guardian registering camper(s).
- [ ] For self-registration, require exactly one camper age 18 or older, use the camper's own contact details with relationship `Self`, and do not display parent/guardian fields.
- [ ] Build the parent or guardian information step with full name, email, phone, mailing address, and relationship to campers.
- [ ] Build repeatable camper entry for one or more children.
- [ ] Capture camper identity, date of birth, gender, shared or overridden address, camper cell, parent contact fields, faith and church fields, pastor name, t-shirt size intent, medical notes, allergies, medications, dietary restrictions, emergency contact, and special needs.
- [ ] Match legacy option lists for gender, state or province, and camper t-shirt sizes.
- [ ] Support a shared family address with optional per-camper overrides.
- [ ] Add client-side and server-side validation for required fields, date formats, phone-number constraints where specified, and repeatable camper rules.
- [ ] Add medical release display and legal signature capture with timestamp and IP address persistence.
- [ ] Present an adult-specific authorization for self-registration without parent/legal-guardian assertions, and require its version to match the selected registration type.
- [ ] Snapshot the exact medical release version or rendered text accepted by the signer so later copy changes do not alter the legal record.
- [ ] Persist a temporary family draft, legal agreement, initial price snapshot, and capacity reservation atomically; create the actual camper records only when Stripe payment succeeds or pay-at-camp is explicitly selected, and do not create individual camper QR tokens.
- [ ] Enforce camper capacity inside the same transaction with concurrency-safe semantics; do not rely on a separate count followed by inserts.
- [ ] Apply the Step 00 registration state and capacity-reservation rules so abandoned or pending-payment submissions cannot permanently consume capacity.
- [ ] Add a client-generated submission idempotency key or equivalent replay protection so double-clicks and safe retries cannot create duplicate families.
- [ ] Set `importSource` or equivalent provenance to online registration while preserving compatibility with Phase 1 admin lists, dorm assignment, check-in, and reports.
- [ ] Apply the public-route request-size, rate-limit, validation, and safe-IP rules established in Step 01 to the family submission endpoint.
- [ ] Add tests for required fields, repeated campers, shared address behavior, legacy option lists, agreement snapshots, signature persistence, absence of individual QR-token data, atomic rollback, concurrent capacity submissions, and idempotent retries.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete a family registration with one camper and confirm records persist correctly.
- [ ] Complete an adult self-registration and confirm it is rejected for a camper under 18, cannot contain multiple campers, and stores the adult agreement snapshot.
- [ ] Complete a family registration with multiple campers using a shared address and one address override.
- [ ] Attempt submission with missing legacy-required fields and confirm useful validation errors.
- [ ] Confirm the stored legal signature includes timestamp and IP address.
- [ ] Force a failure while creating a later camper and confirm no family, camper, signature, or QR data from that submission remains.
- [ ] Submit concurrent families near capacity and confirm confirmed plus active reserved campers never exceed the configured limit.
- [ ] Retry the same idempotent submission and confirm only one family registration exists.

## Completion Criteria

- [ ] A parent can submit the non-payment portions of family camper registration for one or more campers on the registration origin.
- [ ] An adult camper can register themselves without entering parent/guardian information or signing a parent/legal-guardian assertion.
- [ ] No required legacy camper field is omitted from the captured data.
- [ ] Medical release signature data is stored with each relevant family registration.
- [ ] Confirmed campers are available to Phase 1 management workflows; payment-page drafts are not exposed as people.
- [ ] Family creation is atomic, concurrency-safe at capacity, and idempotent under client retries.
