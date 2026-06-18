# BYC Camp Manager — deployment and operations

This document describes how to run, build, migrate, deploy, back up, and observe the Phase 1 camp-management stack (admin + imports + dorms + check-in + reports). **Public self-service registration is not required** for Phase 1 operations.

## Architecture (summary)

- **Web UI**: React SPA (`client`), built to static files under `client/dist`.
- **API**: Node.js + Express (`server`), Prisma ORM, PostgreSQL.
- **Email**: Nodemailer (`server/src/lib/checkInConfirmationMail.ts`) — log-only by default, or SMTP (e.g. Amazon SES SMTP, SendGrid).

Further product context: `docs/specs.md`.

## Environment variables

### API / shared (`server` — loaded from `server/.env` or process env)

| Variable | Local | Staging | Production | Notes |
| -------- | ----- | ------- | ---------- | ----- |
| `NODE_ENV` | `development` | `production` | `production` | |
| `PORT` | `4000` | per host | `4000` or platform default | API listen port |
| `DATABASE_URL` | local Postgres URL | RDS / managed Postgres URL | same | Required; Prisma connection string |
| `JWT_SECRET` | long random string (≥32 chars) | from secrets manager | same | Signs admin session cookies |
| `CORS_ORIGIN` | optional; e.g. `http://127.0.0.1:5173` | `https://admin-staging.example.org` | `https://admin.example.org` | When unset, CORS reflects any origin (dev-friendly only) |
| `CLIENT_DIST_PATH` | usually unset (Vite proxies `/api`) | optional path to `client/dist` | e.g. `/app/client/dist` | When set to an existing directory, the API also serves the SPA and `index.html` fallback for client routes |
| `APP_PUBLIC_URL` | e.g. `http://127.0.0.1:5173` | public staging origin | public production origin | Required for Stripe Checkout success/cancel redirects |
| `STRIPE_SECRET_KEY` | test restricted key (`rk_test_...`) preferred | test/staging restricted key | live restricted key (`rk_live_...`) preferred | Server-only Stripe API key; never expose to client code or logs |
| `STRIPE_WEBHOOK_SECRET` | from `stripe listen` | staging webhook signing secret | production webhook signing secret | Required to verify `checkout.session.completed` webhook events |
| `EMAIL_TRANSPORT` | `log` (default) | `smtp` or `log` | `smtp` for real mail | `log` writes message content to stdout — **do not use for parent-facing mail in prod** |
| `EMAIL_FROM` | n/a if `log` | verified sender | same | Required when `EMAIL_TRANSPORT=smtp` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | n/a if `log` | provider values | same | Required together for SMTP |

Never commit real `.env` files. Use your AWS account secret store, CI OIDC, or platform env configuration (see Human Tasks in step 07 of the development plan).

### Stripe Checkout for self check-in

The camper self check-in page can redirect unpaid campers to Stripe Checkout for their stored remaining balance (`feeDueCents - feePaidCents`). It uses Stripe-hosted Checkout Sessions and relies on the webhook before marking a camper `paid_stripe`.

Local development setup:

1. Create or use a Stripe test-mode account.
2. Prefer a restricted API key with only the permissions needed to create/retrieve Checkout Sessions and read payment results.
3. Set `STRIPE_SECRET_KEY`, `APP_PUBLIC_URL`, and `STRIPE_WEBHOOK_SECRET` in `server/.env`.
4. Forward webhooks locally:

```bash
stripe listen --events checkout.session.completed --forward-to localhost:4000/api/stripe/webhook
```

Use the `whsec_...` value printed by the Stripe CLI as `STRIPE_WEBHOOK_SECRET`. For production, create the same webhook endpoint in the live Stripe account, set the live restricted key and live webhook secret in the production secret store, and keep the test account values out of production.

### Client dev proxy

`client/vite.config.ts` proxies `/api` to `http://127.0.0.1:4000`. Production builds expect the browser to call the same origin as the API (single-host deployment) or a configured API base; align `CORS_ORIGIN` if UI and API are on different origins.

## Production build and database migrations

From the **repository root**:

```bash
npm ci
npm run db:generate
npm run build
```

Apply migrations to the target database (staging or production):

```bash
npm run db:migrate
```

(`db:migrate` runs `prisma migrate deploy` in the `server` workspace — safe for CI/CD and servers.)

Seed is for dev/demo only unless you intentionally seed production:

```bash
npm run db:seed
```

The production Docker image also includes a compiled first-admin bootstrap entrypoint:

```bash
npm run db:seed:prod
```

Use it only through the AWS post-deploy flow with a Secrets Manager JSON secret containing `username` and `password`; legacy secrets containing `email` and `password` are still accepted so pre-username deployments can bootstrap after upgrade. It is for first-admin bootstrap, not routine password resets.

## Health checks

| Target | Endpoint / artifact | Purpose |
| ------ | ------------------- | ------- |
| API liveness | `GET /api/health` | Process up; use for simple LB checks |
| API readiness | `GET /api/health/ready` | PostgreSQL `SELECT 1`; email config summary (no outbound send) |
| Static web (when using Vite `public/`) | `GET /health.json` on the SPA origin | Confirms static deploy served (`client/public/health.json`) |

When `CLIENT_DIST_PATH` is set, `GET /health.json` is served by Express static from the built client assets.

## Application operations logging

Structured JSON lines are written to stdout for operational events (auth, CSV imports, fee CSV import, dorm assignment, check-in, roster/report data loads, check-in confirmation mail outcomes). **Medical free-text, dietary fields, and guardian email addresses are not included** in these lines — roster responses still contain operational fields for authorized admins; logs only record metadata (IDs, counts, filters, mail send status).

## Database backups and restore

**Expectations**

- Use your cloud provider’s **automated backups** for the production Postgres instance (e.g. AWS RDS automated backups with a retention window aligned to church/camp policy — confirm with stakeholders; see Human Tasks in step 07).
- For an extra copy before major changes, run a manual **`pg_dump`** from a bastion or CI job with least privilege.

**Example: logical dump (restore anywhere)**

```bash
pg_dump "$DATABASE_URL" --format=custom --file=byc-camp-$(date +%Y%m%d).dump
```

**Example: restore to a fresh database** (destructive on target — verify connection string first)

```bash
pg_restore --clean --if-exists --dbname="$TARGET_DATABASE_URL" byc-camp-YYYYMMDD.dump
```

Document who owns backup verification (monthly restore test) in your runbook.

## AWS deployment (reference)

The master spec lists **AWS** as hosting with services TBD. This repository ships a **container build** as the primary artifact; you can run it on **ECS Fargate**, **App Runner**, **Elastic Beanstalk**, **EC2**, or another orchestrator.

- **Docker**: see `deploy/Dockerfile` (multi-stage build; run with `DATABASE_URL`, `JWT_SECRET`, and optional `CLIENT_DIST_PATH` / SMTP vars).
- **IaC pointers**: see `infra/README.md` for where to plug health checks, secrets, and RDS.

No cloud resources are provisioned from this repo alone — **Human Tasks** (account, RDS, DNS, secrets) remain with the operator unless you run the CDK app below.

## AWS CDK (programmatic dev / staging)

The CDK app under [`infra/cdk/`](../infra/cdk/) provisions VPC, RDS PostgreSQL, Secrets Manager entries, an ECS Fargate service behind an ALB, and (by default) builds the app image from [`deploy/Dockerfile`](../deploy/Dockerfile).

1. Bootstrap and deploy: see [`infra/cdk/README.md`](../infra/cdk/README.md).
2. **Migrations and first-admin bootstrap** are not run automatically by the web service: run [`scripts/run-post-deploy.ps1`](../scripts/run-post-deploy.ps1) after each deploy.
3. Set `CORS_ORIGIN` with `-c corsOrigin=https://admin.example.org` when serving the UI from a custom domain; otherwise the stack defaults to the ALB DNS origin.
4. **Synth without Docker** (CI or quick validation): `cd infra/cdk && npx cdk synth -c usePlaceholderImage=true`.

## Phase 1 smoke test

Manual checklist: `docs/phase-1-smoke-test.md`.

## Wish-list / out of scope for Phase 1 launch

Phase 1 is intentionally **admin-led** (CSV import, dorms, check-in, reports). The following remain **future** work; they must not block an operational camp week without public registration:

- Full **public family and worker registration** flows (Phase 2+), including registration-time Stripe checkout and related public UX. Arrival-day self check-in can already use Stripe Checkout for an imported/admin-entered camper's stored remaining balance.
- **Multi-year** analytics and historical carry-forward beyond what the current schema already supports for multiple camp years.
- **Parent portal**, **SMS** notifications, **volunteer credentialing** workflows, **waitlist** automation — see `docs/specs.md` section **13. Future / Wish-List Items**.
- **Server-rendered PDF** reports (Phase 1 uses browser print / save as PDF).

Outstanding product TBDs (shirt checkout, report catalog, merch pricing, check-in email copy) are listed at the top of `docs/specs.md`.
