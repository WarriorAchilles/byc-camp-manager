# Step 2.01 - Public Registration Availability

## Things for a Human to Complete

- Confirm the public URLs for family camper registration and worker registration.
- Provide public-facing closed-state copy and countdown copy for each registration flow.
- Confirm whether countdown timers are required or whether a static "opens at" message is acceptable for launch.
- Confirm the exact capacity-full message shown when camper registration is blocked.

## Goal

Add public registration entry points that are separately gated by camp configuration and camper capacity.

## Agent Implementation Tasks

- Create public routes for family camper registration and worker registration.
- Read separate open date/time settings from camp configuration.
- Before each flow opens, show the correct closed state and optional countdown.
- Transition from countdown to live form without requiring a page refresh if countdown behavior is implemented.
- For family camper registration, block new submissions when the configured camper capacity has been reached.
- Ensure worker registration uses its own open date/time and does not depend on camper capacity.
- Add API endpoints that expose only public-safe camp configuration needed by registration pages.
- Add tests for before-open, after-open, capacity-full, and no-capacity-configured states.

## Acceptance Criteria

- Family camper registration and worker registration can open at different dates/times.
- Public users cannot access a live form before its configured open time.
- Camper registration blocks new camper submissions at capacity with clear parent-facing copy.
- Worker registration remains independent of camper capacity.
- Public endpoints do not expose admin-only configuration or secrets.

## Master Spec References

- [Registration Form Availability](../../specs.md#registration-form-availability) - separate open dates, countdown behavior, and public form access.
- [Camp Configuration (Super Admin)](../../specs.md#camp-configuration-super-admin) - registration windows and capacity configuration.
- [1. Overview](../../specs.md#1-overview) - public unauthenticated registration flows.
