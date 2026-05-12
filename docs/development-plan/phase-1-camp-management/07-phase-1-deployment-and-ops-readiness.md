# Step 07: Phase 1 Deployment and Ops Readiness

## Human Tasks Required

- [ ] Choose and provision the AWS account, region, domain, DNS, and billing access for deployment.
- [ ] Provide production database, email, auth, and deployment secrets through the chosen secret manager or CI system.
- [ ] Confirm backup retention, operator access, and any church or camp data-handling requirements.

## Spec References

- `docs/specs.md` - "2. Technical Architecture"
- `docs/specs.md` - "Stack"
- `docs/specs.md` - "Key Technical Considerations"
- `docs/specs.md` - "1. Overview"
- `docs/specs.md` - "13. Future / Wish-List Items"
- `docs/specs.md` - "Outstanding Items & TBD Questions"

## Goal

Prepare the Phase 1 camp-management system for real operational use with deployable infrastructure, production configuration, backups, basic observability, and a final operations smoke test.

## Agent Tasks

- [x] Document local, staging, and production environment variables.
- [x] Add production build and migration commands to repository documentation.
- [x] Add AWS infrastructure or deployment configuration using the repository's chosen deployment approach.
- [x] Configure database backup expectations and document restore steps.
- [x] Add basic application logging for authentication, imports, dorm assignment, check-in, and report export events without logging sensitive medical details.
- [x] Add health checks for the web app, API, database connectivity, and email provider integration where applicable.
- [x] Add a Phase 1 smoke-test checklist that covers login, configuration, import, dorm assignment, check-in, reports, and responsive mobile check-in behavior.
- [x] Document future wish-list items as out of scope for Phase 1 so they do not block operational launch.

## Verification

- [x] Run the repository lint command.
- [x] Run the repository typecheck command.
- [x] Run the repository test command.
- [x] Run the repository build command.
- [x] Apply migrations against a staging or local production-like database.
- [x] Deploy to the chosen AWS environment or produce the deployment artifact if cloud access is not available.
- [ ] Execute the Phase 1 smoke-test checklist against the deployed or production-like environment.

## Completion Criteria

- [x] Phase 1 can be deployed and operated without relying on public registration.
- [x] Required operational workflows have a documented smoke test.
- [x] Secrets, backups, logs, and health checks have a clear owner and implementation path.
- [x] Future wish-list scope is documented as deferred.
