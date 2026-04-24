# Step 1.02 - Camp Configuration

## Things for a Human to Complete

- Provide the camp name, camp year, venue copy, and camp start/end dates for the first configured season.
- Decide whether the camper capacity should be enabled for the first year and what the maximum camper count is.
- Confirm the default age group definitions to seed for the first year, if any.
- Confirm the default early fee, late fee, cutover date/time, and third-plus-child fee values.
- Decide whether admin and CSV paths should hard-block over-cap campers or allow super admins to override with warnings.

## Goal

Create super-admin-owned camp configuration that later drives imports, dorm assignment, check-in, reports, registration availability, registration pricing, and capacity behavior.

## Agent Implementation Tasks

- Add a camp configuration data model for camp name/year, camp dates, registration open dates, capacity, fee schedule, discount tiers, and age group definitions.
- Build super admin UI for editing camp-wide settings.
- Add validation for dates, fee values, capacity values, and age group ranges.
- Store separate public open date/time values for family camper registration and worker registration, even though the public pages are built in Phase 2.
- Add age group management with create, edit, reorder, deactivate, and per-year ownership.
- Add a shared service for resolving a camper age group from date of birth and the configured camp year/date rules.
- Add capacity helper logic that reports current camper count, configured capacity, and whether the camp is full.

## Acceptance Criteria

- Super admins can create and edit the active camp configuration.
- Camp admins can view relevant camp settings but cannot edit super-admin-only settings.
- Age groups are configurable and are not hard-coded into dorm assignment or reports.
- Fee and registration-window fields exist now so Phase 2 can use them without schema redesign.
- Capacity status is available to admin workflows and future public registration workflows.

## Master Spec References

- [Registration Form Availability](../../specs.md#registration-form-availability) - separate public open dates for family and worker registration.
- [Camp Configuration (Super Admin)](../../specs.md#camp-configuration-super-admin) - camp name, dates, capacity, fee schedule, merchandise, and age group settings.
- [Multi-Child Discounts and Early / Late Pricing](../../specs.md#multi-child-discounts-and-early--late-pricing) - configurable early, late, and third-plus-child rates.
- [Camp Configuration](../../specs.md#camp-configuration) - camp configuration data model.
