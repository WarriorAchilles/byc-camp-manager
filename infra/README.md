# AWS infrastructure (reference)

This folder does **not** contain a full turnkey CloudFormation or Terraform stack. The product spec leaves **specific AWS services TBD** (`docs/specs.md`). Use this file as a **checklist** when you add IaC in your org’s standard tool.

## Recommended starting point

1. **PostgreSQL**: Amazon RDS for PostgreSQL (Multi-AZ for production if policy requires).
2. **Application**: Container from `deploy/Dockerfile` on **ECS Fargate** or **App Runner**, or Elastic Beanstalk “Docker” mode.
3. **Secrets**: `DATABASE_URL`, `JWT_SECRET`, SMTP credentials in **AWS Secrets Manager** (or SSM Parameter Store) injected as task env vars.
4. **Load balancer / TLS**: Application Load Balancer + ACM certificate; health check path **`/api/health`** (liveness) and/or **`/api/health/ready`** (stricter).
5. **Observability**: CloudWatch Logs for container stdout (structured ops JSON + Prisma / Node errors).

## Database backups

Enable RDS automated backups; retention and cross-region copy are **policy decisions** (see development plan step 07 Human Tasks). Document restore drills in your camp runbook; technical steps are in `docs/deployment.md`.

## Static front end (optional split)

If the SPA is hosted on **S3 + CloudFront** while the API is separate:

- Upload `client/dist` to the bucket; ensure `health.json` is reachable.
- Configure CORS on the API (`CORS_ORIGIN`) for the CloudFront domain.
- You may omit `CLIENT_DIST_PATH` on the API container in that layout.

## Deployment artifact without cloud CLI

If you cannot push to ECR from automation, `docker build -f deploy/Dockerfile -t byc-camp-manager:local .` from the repo root produces an image that operators can scan and deploy manually.
