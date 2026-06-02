# BYC Camp Manager — AWS CDK (dev / staging)

## Prerequisites

- Node.js 22+ and npm
- Docker (for `cdk deploy` / `cdk synth` when **not** using the placeholder image)
- AWS CLI configured (`aws sts get-caller-identity`)
- CDK bootstrap once per account/region:

```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

## Install and build

```bash
cd infra/cdk
npm ci
npm run build
```

## Synth and deploy

**Fast template validation** (no Docker image build; uses a public Node base image — not runnable for the real app):

```bash
npx cdk synth -c usePlaceholderImage=true
```

**Real deploy** (builds [`../../deploy/Dockerfile`](../../deploy/Dockerfile) with repo root as context; can take several minutes):

```bash
npx cdk deploy
```

Pass account/region if they are not in the environment:

```bash
npx cdk deploy -c account=123456789012 -c region=us-east-1
```

Stack outputs include **LoadBalancerDns** (open `http://…` for the admin UI), cluster/service/task ARNs, subnet IDs, and secret ARNs.

### Context flags

| Context | Effect |
| ------- | ------ |
| `usePlaceholderImage=true` | Skips `DockerImageAsset` build; synth/validate only. |
| `account` / `region` | Passed to the stack `env` (optional if `CDK_DEFAULT_*` / `AWS_*` are set). |
| `corsOrigin` | Sets the API `CORS_ORIGIN`; defaults to `http://<alb-dns-name>`. |
| `appPublicUrl` | Sets `APP_PUBLIC_URL` for Stripe Checkout redirects; defaults to `http://<alb-dns-name>`. |
| `stripeSecretKeySecretArn` | Optional Secrets Manager ARN containing the Stripe restricted/secret API key. |
| `stripeWebhookSecretArn` | Optional Secrets Manager ARN containing the Stripe webhook signing secret. |
| `initialSuperAdminSecretArn` | Optional full Secrets Manager JSON secret ARN with `email` and `password` fields for first-admin bootstrap. Include the generated suffix, e.g. `...:secret:initial-admin-AbCdEf`. |

## CORS

The task sets `CORS_ORIGIN` to `http://<alb-dns-name>` by default. After you add HTTPS and a stable hostname, redeploy with an explicit origin:

```bash
npx cdk deploy -c corsOrigin=https://admin.example.org
```

Set the same public HTTPS origin for Stripe redirects after DNS is in place:

```bash
npx cdk deploy -c corsOrigin=https://admin.example.org -c appPublicUrl=https://admin.example.org
```

To enable Stripe Checkout in ECS, store the Stripe API key and webhook signing secret as separate Secrets Manager plaintext secrets, then pass their ARNs:

```bash
npx cdk deploy \
  -c appPublicUrl=https://admin.example.org \
  -c stripeSecretKeySecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:stripe-key \
  -c stripeWebhookSecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:stripe-webhook
```

To enable first-admin bootstrap in the post-deploy step, create a Secrets Manager secret with this JSON shape and pass its ARN at deploy time:

```json
{
  "email": "admin@example.org",
  "password": "long-random-password"
}
```

```bash
npx cdk deploy -c initialSuperAdminSecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:initial-admin-AbCdEf
```

## Post-deploy database setup

After each successful deploy, run the post-deploy script from the repository root:

```powershell
.\scripts\run-post-deploy.ps1 -StackName BycCampDevStack -Region us-east-2
```

The script runs two one-off ECS Fargate tasks using the deployed task definition, public subnets, and ECS security group from stack outputs:

1. `cd /app/server && npx prisma migrate deploy`
2. `cd /app/server && npm run db:seed:prod`

`prisma migrate deploy` is safe to run on every deploy; it applies only pending migrations. The seed step is only for first-admin bootstrap and is idempotent when the configured admin email already exists. Do not use the seed step for routine password resets.

Low-level equivalent for the migration task:

```powershell
aws ecs run-task `
  --cluster YOUR_CLUSTER_NAME `
  --launch-type FARGATE `
  --task-definition YOUR_TASK_DEF_ARN `
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaa,subnet-bbb],securityGroups=[sg-ccc],assignPublicIp=ENABLED}" `
  --overrides '{"containerOverrides":[{"name":"web","command":["sh","-c","cd /app/server && npx prisma migrate deploy"]}]}'
```

The production image includes the `prisma` CLI (`server` dependency) so `npx prisma migrate deploy` works from `/app/server` where `prisma/schema.prisma` lives.

Wait for the tasks to stop, then check the log group and stream printed by the script, or hit `GET /api/health/ready` on the load balancer.

## Destroy

```bash
npx cdk destroy
```

RDS and secrets use dev removal policies; confirm you are not deleting production data.
