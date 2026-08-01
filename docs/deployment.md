# BYC Camp Manager — deployment and operations

This document describes how to run, build, migrate, deploy, back up, and observe the Phase 1 camp-management stack (admin + imports + dorms + check-in + reports). **Public self-service registration is not required** for Phase 1 operations.

## Architecture (summary)

- **Web UI**: React SPA (`client`), built to static files under `client/dist`.
- **API**: Node.js + Express (`server`), Prisma ORM, PostgreSQL.
- **Email**: one shared Nodemailer delivery service (`server/src/lib/emailDelivery.ts`) for check-in and registration confirmations. Real delivery uses the Amazon SES SMTP relay; tests/CI use a non-network, metadata-only log transport.

Further product context: `docs/specs.md`.

## Environment variables

### API / shared (`server` — loaded from `server/.env` or process env)

| Variable | Local | Staging | Production | Notes |
| -------- | ----- | ------- | ---------- | ----- |
| `NODE_ENV` | `development` | `production` | `production` | |
| `PORT` | `4000` | per host | `4000` or platform default | API listen port |
| `DATABASE_URL` | local Postgres URL | RDS / managed Postgres URL | same | Required; Prisma connection string |
| `JWT_SECRET` | long random string (≥32 chars) | from secrets manager | same | Signs admin session cookies |
| `ADMIN_PUBLIC_ORIGIN` | `http://localhost:5173` | admin/check-in staging origin | admin/check-in production origin | Trusted admin/check-in origin and self-check-in Stripe redirect origin |
| `REGISTRATION_PUBLIC_ORIGIN` | `http://registration.localhost:5173` | registration staging origin | registration production origin | Trusted registration origin; must differ from the admin origin |
| `TRUST_PROXY_HOPS` | `0` | deployment-specific | deployment-specific | Exact trusted proxy hop count used for client IP resolution; CDK uses `1` |
| `CLIENT_DIST_PATH` | usually unset (Vite proxies `/api`) | optional path to `client/dist` | e.g. `/app/client/dist` | When set to an existing directory, the API also serves the SPA and `index.html` fallback for client routes |
| `STRIPE_SECRET_KEY` | test restricted key (`rk_test_...`) preferred | test/staging restricted key | live restricted key (`rk_live_...`) preferred | Server-only Stripe API key; never expose to client code or logs |
| `STRIPE_WEBHOOK_SECRET` | from `stripe listen` | staging webhook signing secret | production webhook signing secret | Required to verify `checkout.session.completed` webhook events |
| `EMAIL_TRANSPORT` | `log` (default) | `smtp` | `smtp` | `smtp` sends all check-in, family-registration, and worker-registration confirmations; `log` performs no network send and records safe metadata/status only |
| `EMAIL_FROM` | n/a if `log` | SES-verified sender/domain | same | Required for `smtp`; the identity must be verified in the SES sending region |
| `SMTP_HOST` | n/a if `log` | `email-smtp.<region>.amazonaws.com` | same | Regional SES SMTP endpoint shared by every transactional email type |
| `SMTP_PORT` | n/a if `log` | `587` | same | STARTTLS; use `465` only for intentionally configured implicit TLS |
| `SMTP_USER` | n/a if `log` | secret store | same | Region-specific username generated under SES SMTP settings |
| `SMTP_PASS` | n/a if `log` | secret store | same | Region-specific SES SMTP password; never commit or log it |

Never commit real `.env` files. Use your AWS account secret store, CI OIDC, or platform env configuration (see Human Tasks in step 07 of the development plan).

### Amazon SES transactional email

The same SMTP settings deliver camper check-in confirmations and family/worker registration confirmations. In the AWS region used for sending, create and verify an SES domain identity, publish the generated DKIM records, and request production access so the application can send to unverified recipients. Generate SES SMTP credentials for that region and store both `SMTP_USER` and `SMTP_PASS` in the deployment secret store. SES SMTP credentials are not ordinary AWS access keys and are region-specific.

Set `SMTP_HOST` to the regional endpoint, such as `email-smtp.us-east-2.amazonaws.com`, and set `EMAIL_FROM` to an address covered by the verified identity. Delivery results and the Nodemailer provider message identifier (when supplied) are recorded in `email_delivery_attempts` for registration emails; the public registration API never returns that identifier.

`EMAIL_TRANSPORT=log` is intended for automated tests and CI. It does not connect to SES and logs only the template key, transport, and status. Recipient addresses, subjects, bodies, medical/legal data, and submitted worker responses must not be written to application logs.

### Stripe Checkout for self check-in

The camper self check-in page can redirect unpaid campers to Stripe Checkout for their stored remaining balance (`feeDueCents - feePaidCents`). It uses Stripe-hosted Checkout Sessions and relies on the webhook before marking a camper `paid_stripe`.

Local development setup:

1. Create or use a Stripe test-mode account.
2. Prefer a restricted API key with only the permissions needed to create/retrieve Checkout Sessions and read payment results.
3. Set `STRIPE_SECRET_KEY`, both public origins, and `STRIPE_WEBHOOK_SECRET` in `server/.env`.
4. Forward webhooks locally:

```bash
stripe listen --events checkout.session.completed --forward-to localhost:4000/api/stripe/webhook
```

Use the `whsec_...` value printed by the Stripe CLI as `STRIPE_WEBHOOK_SECRET`. For production, create the same webhook endpoint in the live Stripe account, set the live restricted key and live webhook secret in the production secret store, and keep the test account values out of production.

### Client dev proxy

`client/vite.config.ts` proxies `/api` to `http://127.0.0.1:4000`. Set `VITE_REGISTRATION_PUBLIC_ORIGIN` when building the client; Docker/CDK supplies it from `registrationPublicOrigin`. The API trusts only the two configured origins.

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

Structured JSON lines are written to stdout for operational events (auth, CSV imports, fee CSV import, dorm assignment, check-in, roster/report data loads, and transactional email outcomes). **Recipient addresses, email subjects/bodies, medical or legal data, dietary fields, and worker response copies are not included** in these lines — roster responses still contain operational fields for authorized admins; logs only record safe metadata (IDs, counts, filters, template keys, and mail status).

## Database backups and restore

**Expectations**

- The CDK stack configures **seven days of RDS point-in-time backup retention**. Confirm the live setting after deployment and complete the documented annual snapshot restore drill.
- For an extra copy before major changes, run a manual **`pg_dump`** from a bastion or CI job with least privilege.

**Example: logical dump (restore anywhere)**

```bash
pg_dump "$DATABASE_URL" --format=custom --file=byc-camp-$(date +%Y%m%d).dump
```

**Example: restore to a fresh database** (destructive on target — verify connection string first)

```bash
pg_restore --clean --if-exists --dbname="$TARGET_DATABASE_URL" byc-camp-YYYYMMDD.dump
```

Document who owns backup verification and the annual restore drill in your runbook.

## AWS deployment (reference)

The master spec lists **AWS** as hosting with services TBD. This repository ships a **container build** as the primary artifact; you can run it on **ECS Fargate**, **App Runner**, **Elastic Beanstalk**, **EC2**, or another orchestrator.

- **Docker**: see `deploy/Dockerfile` (multi-stage build; run with `DATABASE_URL`, `JWT_SECRET`, and optional `CLIENT_DIST_PATH` / SMTP vars).
- **IaC pointers**: see `infra/README.md` for where to plug health checks, secrets, and RDS.

No cloud resources are provisioned from this repo alone — **Human Tasks** (account, RDS, DNS, secrets) remain with the operator unless you run the CDK app below.

## AWS CDK (programmatic dev / staging)

The CDK app under [`infra/cdk/`](../infra/cdk/) provisions VPC, RDS PostgreSQL, Secrets Manager entries, an ECS Fargate service behind an ALB, and (by default) builds the app image from [`deploy/Dockerfile`](../deploy/Dockerfile).

1. Bootstrap and deploy: see [`infra/cdk/README.md`](../infra/cdk/README.md).
2. **Migrations and first-admin bootstrap** are not run automatically by the web service: run [`scripts/run-post-deploy.ps1`](../scripts/run-post-deploy.ps1) after each deploy.
3. Set the required `adminPublicOrigin` and `registrationPublicOrigin` CDK contexts to distinct HTTPS origins.
4. **Synth without Docker** (CI or quick validation): `cd infra/cdk && npx cdk synth -c usePlaceholderImage=true -c opsAlertEmail=operations@example.org`.

## Phase 1 smoke test

Manual checklist: `docs/phase-1-smoke-test.md`.

## Wish-list / out of scope for Phase 1 launch

Phase 1 is intentionally **admin-led** (CSV import, dorms, check-in, reports). The following remain **future** work; they must not block an operational camp week without public registration:

- Full **public family and worker registration** flows (Phase 2+), including registration-time Stripe checkout and related public UX. Arrival-day self check-in can already use Stripe Checkout for an imported/admin-entered camper's stored remaining balance.
- **Multi-year** analytics and historical carry-forward beyond what the current schema already supports for multiple camp years.
- **Parent portal**, **SMS** notifications, **volunteer credentialing** workflows, **waitlist** automation — see `docs/specs.md` section **13. Future / Wish-List Items**.
- **Server-rendered PDF** reports (Phase 1 uses browser print / save as PDF).

Outstanding product TBDs (shirt checkout, report catalog, merch pricing, check-in email copy) are listed at the top of `docs/specs.md`.
