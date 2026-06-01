# AWS infrastructure

## CDK application (dev / staging)

The **AWS CDK** app in [`cdk/`](cdk/) deploys a single stack (`BycCampDevStack`) with:

- VPC (2 AZs, public subnets for ALB + Fargate, isolated private subnets for RDS, **no NAT**)
- RDS PostgreSQL (`t3.micro`, single-AZ, dev-friendly removal policies)
- Secrets Manager: RDS master secret, Prisma `DATABASE_URL` secret (filled by a custom resource), JWT secret, optional first-admin bootstrap secret
- ECS Fargate service + internet-facing ALB (HTTP :80) → container port **4000**
- Docker image from [`../deploy/Dockerfile`](../deploy/Dockerfile) (monorepo root as build context) unless you use the placeholder context below

See [`cdk/README.md`](cdk/README.md) for bootstrap, deploy, synth, and post-deploy database setup commands.

## Checklist (conceptual)

1. **PostgreSQL**: RDS in the CDK stack; enable backups in the console or extend CDK for retention policies.
2. **Application**: ECS Fargate + ALB from CDK; health check `GET /api/health`.
3. **Secrets**: `DATABASE_URL` and `JWT_SECRET` from Secrets Manager on the task; optional Stripe and first-admin bootstrap secrets can be added through CDK context.
4. **TLS**: first revision uses HTTP on port 80. Add an ACM certificate and an HTTPS listener when you have a domain in Route 53.
5. **Observability**: CloudWatch Logs for the app container and the database URL sync Lambda.

## Database backups

Enable RDS automated backups in the AWS console (or add `backupRetention` on the instance in CDK). Restore drills: `docs/deployment.md`.

## Static front end (optional split)

The default Docker image serves the SPA from the API (`CLIENT_DIST_PATH`). To host static files on S3 + CloudFront instead, split the image or omit `CLIENT_DIST_PATH` and point the SPA at the API; set `CORS_ORIGIN` accordingly.

## Manual Docker image (without CDK)

From the repository root: `docker build -f deploy/Dockerfile -t byc-camp-manager:local .`
