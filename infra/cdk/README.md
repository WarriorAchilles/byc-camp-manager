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

## Database migrations (one-off ECS RunTask)

After the first successful deploy, run Prisma migrations **once** against RDS using the **same** task definition and subnets/security group as the service. Replace placeholders with values from stack outputs (`ClusterName`, `TaskDefinitionArn`, comma-separated `PublicSubnetIds`, `EcsSecurityGroupId`).

PowerShell (split subnet IDs from output into an array for `--subnets`):

```powershell
aws ecs run-task `
  --cluster YOUR_CLUSTER_NAME `
  --launch-type FARGATE `
  --task-definition YOUR_TASK_DEF_ARN `
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaa,subnet-bbb],securityGroups=[sg-ccc],assignPublicIp=ENABLED}" `
  --overrides '{"containerOverrides":[{"name":"web","command":["sh","-c","cd /app/server && npx prisma migrate deploy"]}]}'
```

The production image includes the `prisma` CLI (`server` dependency) so `npx prisma migrate deploy` works from `/app/server` where `prisma/schema.prisma` lives.

Wait for the task to stop, then check logs in the log group printed for the task family, or hit `GET /api/health/ready` on the load balancer.

## Destroy

```bash
npx cdk destroy
```

RDS and secrets use dev removal policies; confirm you are not deleting production data.
