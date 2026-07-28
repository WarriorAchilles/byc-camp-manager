# AWS infrastructure

## CDK application (dev / staging)

The **AWS CDK** app in [`cdk/`](cdk/) deploys a single stack (`BycCampDevStack`) with:

- VPC (2 AZs, public subnets for ALB + Fargate, isolated private subnets for RDS, **no NAT**)
- RDS PostgreSQL (`t4g.micro`, single-AZ, protected backup/snapshot policies)
- Secrets Manager: RDS master secret, Prisma `DATABASE_URL` secret (filled by a custom resource), JWT secret, optional first-admin bootstrap secret
- ECS Fargate service + internet-facing ALB (HTTP :80) → container port **4000**
- Docker image from [`../deploy/Dockerfile`](../deploy/Dockerfile) (monorepo root as build context) unless you use the placeholder context below

See [`cdk/README.md`](cdk/README.md) for bootstrap, deploy, synth, and post-deploy database setup commands.

## Checklist (conceptual)

1. **PostgreSQL**: RDS in the CDK stack with seven-day point-in-time backups, explicit backup/maintenance windows, deletion protection, and snapshot-on-delete behavior.
2. **Application**: ECS Fargate + ALB from CDK; health check `GET /api/health`.
3. **Secrets**: `DATABASE_URL` and `JWT_SECRET` from Secrets Manager on the task; optional Stripe and first-admin bootstrap secrets can be added through CDK context.
4. **TLS**: first revision uses HTTP on port 80. Add an ACM certificate and an HTTPS listener when you have a domain in Route 53.
5. **Observability**: CloudWatch Logs for the app container and the database URL sync Lambda.

## Database backups and seasonal hibernation

The CDK stack configures RDS backup retention and seasonal ECS/RDS automation.
From February 1 through August 1 the service is active; during the off-season
the ALB serves a closed-season response while ECS is at zero and RDS is stopped.
RDS is started weekly for backup and maintenance work. Deployment preflight,
manual controller commands, alert confirmation, and restore-drill instructions
are in [`cdk/README.md`](cdk/README.md). General restore guidance remains in
[`docs/deployment.md`](../docs/deployment.md).

## Static front end (optional split)

The default Docker image serves the SPA from the API (`CLIENT_DIST_PATH`). To host static files on S3 + CloudFront instead, split the image or omit `CLIENT_DIST_PATH`, point the SPA at the API, and configure both trusted public origins.

## Manual Docker image (without CDK)

From the repository root: `docker build -f deploy/Dockerfile -t byc-camp-manager:local .`
