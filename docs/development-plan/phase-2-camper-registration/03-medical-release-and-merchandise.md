# Step 2.03 - Medical Release and Merchandise

## Things for a Human to Complete

- Provide the final medical release and liability waiver text.
- Confirm whether legal signature should be typed, drawn, checkbox-based, or a combination.
- Confirm the merchandise catalog for the registration period: item names, prices, sizes, colors, and availability.
- Confirm whether merchandise is selected per camper, per family, or both depending on item type.
- Confirm whether merchandise copy should mention existing online or in-person sales channels.

## Goal

Add the legal agreement step and optional merchandise pre-order experience to family camper registration.

## Agent Implementation Tasks

- Display the medical release and liability waiver text during family registration.
- Capture legal signature details, acknowledgment checkbox, timestamp, and IP address.
- Store medical release status and signature metadata with the family registration and/or each camper as appropriate.
- Add admin-configured merchandise items with name, price, active status, and options such as size or color.
- Display active merchandise items in the public registration flow after the medical release.
- Allow optional merchandise pre-orders with item, selected options, quantity, unit price, and line total.
- Allow parents to skip merchandise entirely.
- Ensure merchandise selections flow into pricing, payment, confirmation, reports, and email steps.

## Acceptance Criteria

- A family registration cannot proceed past the legal step without the required acknowledgment/signature.
- Legal signature metadata is stored for audit purposes.
- Merchandise pre-ordering is optional.
- Inactive merchandise items do not appear publicly.
- Merchandise order records preserve selected options and historical unit prices.

## Master Spec References

- [Step 3 - Medical Release & Legal Agreement](../../specs.md#step-3---medical-release--legal-agreement) - waiver display, digital signature, timestamp, and IP capture.
- [Step 4 - Merchandise Pre-Order (Optional)](../../specs.md#step-4---merchandise-pre-order-optional) - optional merchandise selection and pricing configuration.
- [Merchandise Order](../../specs.md#merchandise-order) - merchandise order data model.
- [Merchandise Item (Admin-Configured)](../../specs.md#merchandise-item-admin-configured) - admin-configured merchandise catalog model.
- [Outstanding Items & TBD Questions](../../specs.md#outstanding-items--tbd-questions) - merchandise pricing decision.
