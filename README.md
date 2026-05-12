# BYC Camp Manager

## License / copyright

Copyright © 2026. All rights reserved.

This repository and its contents are proprietary. No permission is granted to use, copy, modify, merge, publish, distribute, sublicense, or sell copies of this software or related materials without explicit written permission from the copyright holder.

## Development

From the repository root:

```bash
npm ci
npm run dev
```

The Vite dev server proxies `/api` to the API on port 4000. Configure `server/.env` with at least `DATABASE_URL` and `JWT_SECRET` (see `docs/deployment.md`).

## Production build, migrations, and operations

- Environment variables, backups, health checks, logging, and AWS-oriented deployment: `docs/deployment.md`
- Phase 1 smoke test checklist: `docs/phase-1-smoke-test.md`
- Container image (API + built SPA): `docker build -f deploy/Dockerfile -t byc-camp-manager:latest .`
- AWS checklist (RDS, ECS/Fargate, secrets, load balancer probes): `infra/README.md`

Production-oriented commands from the repo root:

```bash
npm ci
npm run db:generate
npm run build
npm run db:migrate
```

Run the API in production mode with a process manager or container; set `CLIENT_DIST_PATH` to the absolute path of `client/dist` when serving the admin UI from the same host as the API (see `docs/deployment.md`).
