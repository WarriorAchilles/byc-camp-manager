# Step 1.03 - People Records and Admin CRUD

## Things for a Human to Complete

- Confirm which camper medical, dietary, medication, emergency contact, and special needs fields must be visible to admins in year one.
- Confirm whether dorm leaders and workers are always separate records, or whether a person may hold both roles in the same year.
- Confirm whether worker testimony and pastor recommendation should be tracked in-system now or left as future optional flags.
- Provide any preferred labels for gender values, phone formatting, and address fields.

## Goal

Build the admin-managed records for campers, workers, and dorm leaders so camp operations can run without public registration.

## Agent Implementation Tasks

- Add camper records with identity, date of birth, gender, address, parent/guardian contact, church/faith fields, medical fields, t-shirt size, emergency contact, special needs, import source, QR token, dorm assignment, and check-in fields.
- Add worker records with identity, contact, address, gender, church, pastor contact, task preference fields, worker t-shirt size, provenance, dorm assignment, and check-in fields.
- Add dorm leader records with identity, contact, gender, role, camper dorm assignment, and check-in fields.
- Build admin CRUD screens for campers, workers, and dorm leaders.
- Add filtering and search by name, gender, role, dorm assignment, check-in status, and payment status where relevant.
- Ensure workers and dorm leaders are not part of camper registration payment workflows.
- Add tests around required fields and role-specific constraints.

## Acceptance Criteria

- Admins can create, view, edit, and archive or delete people according to the product's chosen retention policy.
- Camper records can exist without an online family registration.
- Worker records can be created by admins and later also by public worker registration.
- Dorm leaders are assignable only to camper dorms once dorms exist.
- QR token values are unique for campers, including imported or manually created campers.

## Master Spec References

- [People in the System](../../specs.md#people-in-the-system) - campers, workers, dorm leaders, and role distinctions.
- [Camper](../../specs.md#camper) - camper operational and profile fields.
- [Worker (volunteer / staff)](../../specs.md#worker-volunteer--staff) - worker profile, provenance, task preferences, and admin fields.
- [Dorm Leader](../../specs.md#dorm-leader) - dorm leader profile and check-in fields.
- [Camper fields (legacy parity)](../../specs.md#camper-fields-legacy-parity) - camper contact, faith, shirt, and legacy field requirements.
