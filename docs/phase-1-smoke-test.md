# Phase 1 operations smoke test

Run this checklist against **staging** or **production** after deploy (or against a **production-like** local build: `npm run build`, `npm run db:migrate`, API with real SMTP if testing mail). Record pass/fail and who ran the test.

**Prerequisites**: active camp year, at least one super admin and one camp admin account, sample campers (import or seed), dorms configured, optional SMTP for check-in confirmation email.

## 1. Health

- [ ] `GET /api/health` returns HTTP 200 and `{ "ok": true, ... }`.
- [ ] `GET /api/health/ready` returns HTTP 200 when the database is reachable; email section reflects your `EMAIL_TRANSPORT` / SMTP configuration.
- [ ] If the web tier serves static files: `GET /health.json` returns `{ "ok": true, "service": "byc-camp-manager-web" }` (from `client/public/health.json` in builds).

## 2. Login and roles

- [ ] Super admin can log in at `/admin/login`.
- [ ] Camp admin can log in; super-only routes (e.g. camp configuration, user admin, imports) behave as forbidden or hidden per product rules.
- [ ] Logout clears the session; protected routes redirect or 401 appropriately.

## 3. Camp configuration

- [ ] Super admin can open camp configuration, create or edit a camp year, dorms, age brackets, and operational toggles relevant to check-in.

## 4. Imports

- [ ] Camper CSV import: preview → commit (or skip-invalid flow) updates camper records as expected.
- [ ] Worker and dorm leader imports behave as expected when used.
- [ ] Camper fee CSV import (if used): preview → commit updates fee fields without corrupting unrelated campers.

## 5. Dorm assignment

- [ ] Dorm inventory CRUD works for the active year.
- [ ] Assignment board loads; manual assign / unassign works for camper, worker, and dorm leader as applicable.
- [ ] Auto-assign runs and respects capacity / rules (spot-check a few assignments).

## 6. Check-in (admin)

- [ ] Check-in dashboard summary loads.
- [ ] Search finds a known camper; check-in completes (and optional cash-paid flags if you use them).
- [ ] QR lookup path works when enabled for the year.
- [ ] Worker and dorm leader check-in paths complete.
- [ ] If SMTP is configured, guardian receives check-in confirmation email; if `EMAIL_TRANSPORT=log`, API logs show a log line without exposing secrets.

## 7. Reports and exports

- [ ] Reports page: dorm roster loads for a selected camper dorm; filters behave sensibly.
- [ ] **Print / Save as PDF** produces a usable document for dorm leaders (browser print).
- [ ] Check-in status report section loads and prints.

## 8. Mobile / responsive self check-in (public link)

- [ ] Open the camp self check-in URL (`/self-check-in/:token`) on a **narrow phone viewport** (or real device).
- [ ] Search and check-in flow is usable without horizontal scrolling for core controls.
- [ ] A test check-in completes and shows the expected confirmation state.

## 9. Logs (optional)

- [ ] In your log sink, confirm structured lines appear for login, import commit, dorm assignment, check-in, roster view, and mail status — without medical narrative text in log fields.

---

**Sign-off**

- Date: _______________
- Environment (URL): _______________
- Tester: _______________
