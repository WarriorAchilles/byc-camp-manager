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

Implement the public family registration form through parent information, repeatable camper information, and medical release capture, while preserving legacy camper-form field parity.

## Agent Tasks

- [ ] Build the parent or guardian information step with full name, email, phone, mailing address, and relationship to campers.
- [ ] Build repeatable camper entry for one or more children.
- [ ] Capture camper identity, date of birth, gender, shared or overridden address, camper cell, parent contact fields, faith and church fields, pastor name, t-shirt size intent, medical notes, allergies, medications, dietary restrictions, emergency contact, and special needs.
- [ ] Match legacy option lists for gender, state or province, and camper t-shirt sizes.
- [ ] Support a shared family address with optional per-camper overrides.
- [ ] Add client-side and server-side validation for required fields, date formats, phone-number constraints where specified, and repeatable camper rules.
- [ ] Add medical release display and legal signature capture with timestamp and IP address persistence.
- [ ] Save submitted family registration and camper records with payment status ready for the payment step.
- [ ] Generate unique QR tokens for registered campers if not already created by the persistence layer.
- [ ] Add tests for required fields, repeated campers, shared address behavior, legacy option lists, medical release persistence, and QR token uniqueness.

## Verification

- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command.
- [ ] Complete a family registration with one camper and confirm records persist correctly.
- [ ] Complete a family registration with multiple campers using a shared address and one address override.
- [ ] Attempt submission with missing legacy-required fields and confirm useful validation errors.
- [ ] Confirm the stored legal signature includes timestamp and IP address.

## Completion Criteria

- [ ] A parent can submit the non-payment portions of family camper registration for one or more campers.
- [ ] No required legacy camper field is omitted from the captured data.
- [ ] Medical release signature data is stored with each relevant family registration.
- [ ] Submitted campers are available to Phase 1 management workflows.
