# BYC Camp Manager — AWS CDK (dev / staging)

## Prerequisites

- Node.js 22+ and npm
- Docker (for `cdk deploy` / `cdk synth` when **not** using the placeholder image)
- AWS CLI configured (`aws sts get-caller-identity`)
- CDK bootstrap once per account/region:

```bash
npx cdk bootstrap aws://ACCOUNT_ID/REGION
```

### ARM64 builds on x64 Docker hosts

The Fargate image targets ARM64. If Docker Desktop runs on an x64 machine and an ARM64
build fails with `exec format error` or an early `RUN` step exits unexpectedly, register
the ARM64 binfmt/QEMU handler:

```powershell
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

Docker Desktop may require this command again after a restart. Verify support with:

```powershell
docker run --rm --platform linux/arm64 node:22-bookworm-slim uname -m
```

The verification command should print `aarch64`.

## Install and build

```bash
cd infra/cdk
npm ci
npm run build
```

## Synth and deploy

**Fast template validation** (no Docker image build; uses a public Node base image — not runnable for the real app):

```bash
npx cdk synth -c usePlaceholderImage=true -c opsAlertEmail=operations@example.org
```

**Real deploy** (builds [`../../deploy/Dockerfile`](../../deploy/Dockerfile) with repo root as context; can take several minutes):

```bash
npx cdk deploy -c opsAlertEmail=operations@example.org
```

Pass account/region if they are not in the environment:

```bash
npx cdk deploy -c account=123456789012 -c region=us-east-1 -c opsAlertEmail=operations@example.org
```

Stack outputs include **LoadBalancerDns** (open `http://…` for the admin UI), cluster/service/task ARNs, subnet IDs, and secret ARNs.

### Context flags

| Context | Effect |
| ------- | ------ |
| `usePlaceholderImage=true` | Skips `DockerImageAsset` build; synth/validate only. |
| `account` / `region` | Passed to the stack `env` (optional if `CDK_DEFAULT_*` / `AWS_*` are set). |
| `adminPublicOrigin` | Required admin/check-in HTTPS origin; sets `ADMIN_PUBLIC_ORIGIN`. |
| `registrationPublicOrigin` | Required, distinct registration HTTPS origin; sets `REGISTRATION_PUBLIC_ORIGIN` and the client build-time registration origin. |
| `certificateArn` | Optional ACM certificate ARN for the admin hostname. When set, the ALB serves HTTPS on port 443 and redirects HTTP to HTTPS. |
| `opsAlertEmail` | Required operator email for seasonal-controller, scheduler, and RDS event alerts. Pass at deploy time rather than committing a personal address. |
| `seasonWakeMonthDay` | Annual wake date in `MM-DD` format. Default: `02-01`. |
| `seasonHibernateMonthDay` | Annual hibernation date in `MM-DD` format. Default: `08-01`. |
| `seasonTransitionTime` | Local wake/hibernate time in 24-hour `HH:mm` format. Default: `08:00`. |
| `seasonTimeZone` | IANA time zone used for annual transitions. Default: `America/New_York`. |
| `stripeSecretKeySecretArn` | Optional full Secrets Manager ARN containing the Stripe restricted/secret API key. Include the generated suffix. |
| `stripeWebhookSecretArn` | Optional full Secrets Manager ARN containing the Stripe webhook signing secret. Include the generated suffix. |
| `initialSuperAdminSecretArn` | Optional full Secrets Manager JSON secret ARN with `username` and `password` fields for first-admin bootstrap. Legacy `email` plus `password` secrets are also accepted during username migration. Include the generated suffix, e.g. `...:secret:initial-admin-AbCdEf`. |

## HTTPS and CORS

Configure both stable browser origins before deployment:

```bash
npx cdk deploy \
  -c opsAlertEmail=operations@example.org \
  -c adminPublicOrigin=https://admin.example.org \
  -c registrationPublicOrigin=https://registration.example.org
```

AWS sends a confirmation message for the SNS subscription after the first
deployment. Alerts are not delivered until the recipient confirms it.

To serve both BYC hostnames, first request and validate an ACM certificate covering the admin and registration names in the same region as this stack. Then deploy with the certificate ARN and matching public origins:

```bash
npx cdk deploy \
  -c opsAlertEmail=operations@example.org \
  -c certificateArn=arn:aws:acm:REGION:ACCOUNT:certificate/CERTIFICATE_ID \
  -c adminPublicOrigin=https://admin.believersyouthcamp.com \
  -c registrationPublicOrigin=https://registration.believersyouthcamp.com
```

When `certificateArn` is set, the load balancer allows HTTPS traffic on port 443, forwards HTTPS traffic to the app target group while the active-season rule is enabled, and redirects HTTP traffic on port 80 to HTTPS.

To enable Stripe Checkout in ECS, store the Stripe API key and webhook signing secret as separate Secrets Manager plaintext secrets, then pass their ARNs:

```bash
npx cdk deploy \
  -c opsAlertEmail=operations@example.org \
  -c adminPublicOrigin=https://admin.example.org \
  -c registrationPublicOrigin=https://registration.example.org \
  -c stripeSecretKeySecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:stripe-key \
  -c stripeWebhookSecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:stripe-webhook
```

To enable first-admin bootstrap in the post-deploy step, create a Secrets Manager secret with this JSON shape and pass its ARN at deploy time:

```json
{
  "username": "admin",
  "password": "long-random-password"
}
```

```bash
npx cdk deploy \
  -c opsAlertEmail=operations@example.org \
  -c initialSuperAdminSecretArn=arn:aws:secretsmanager:REGION:ACCOUNT:secret:initial-admin-AbCdEf
```

## Post-deploy database setup

After each successful deploy, run the post-deploy script from the repository root:

```powershell
.\scripts\run-post-deploy.ps1 -StackName BycCampDevStack -Region us-east-2
```

The script runs two one-off ECS Fargate tasks using the deployed task definition, public subnets, and ECS security group from stack outputs:

1. `cd /app/server && npx prisma migrate deploy`
2. `cd /app/server && npm run db:seed:prod`

`prisma migrate deploy` is safe to run on every deploy; it applies only pending migrations. The seed step is only for first-admin bootstrap and skips creation when any super admin already exists. Do not use the seed step for routine password resets.

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

## Database protection and seasonal operations

The stack configures seven days of point-in-time backups, a daily
`05:00-05:30 UTC` backup window, a Sunday `06:00-06:30 UTC` maintenance
window, deletion protection, retained automated backups, snapshot-on-delete,
and retained database/application secrets.

The application is active from February 1 at 08:00 through August 1 at 08:00
in `America/New_York`. During hibernation the ALB returns a small HTML `503`
page, ECS runs zero tasks, and RDS is stopped. A Sunday maintenance execution
starts RDS before the backup and maintenance windows, keeps it available for
four hours, and stops it again. A daily reconciliation execution repairs
safe-state drift.

The controller accepts:

```json
{
  "operation": "WAKE | HIBERNATE | MAINTENANCE | RECONCILE",
  "source": "operator"
}
```

### Required pre-deploy checks

Run the following yourself from a terminal with production AWS credentials.
Do not deploy until the diff shows in-place changes for RDS, its generated
secret, and the ECS service.

```powershell
$region = "us-east-2"
$stackName = "BycCampDevStack"

$dbResource = aws cloudformation list-stack-resources `
  --stack-name $stackName `
  --region $region `
  --query "StackResourceSummaries[?ResourceType=='AWS::RDS::DBInstance'] | [0]" `
  --output json | ConvertFrom-Json
$dbIdentifier = $dbResource.PhysicalResourceId

aws rds describe-db-instances `
  --db-instance-identifier $dbIdentifier `
  --region $region `
  --query "DBInstances[0].{Status:DBInstanceStatus,Encrypted:StorageEncrypted,BackupRetention:BackupRetentionPeriod,BackupWindow:PreferredBackupWindow,MaintenanceWindow:PreferredMaintenanceWindow,DeletionProtection:DeletionProtection}"

$snapshotName = "byc-pre-seasonal-$(Get-Date -Format yyyyMMdd-HHmmss)"
aws rds create-db-snapshot `
  --db-instance-identifier $dbIdentifier `
  --db-snapshot-identifier $snapshotName `
  --region $region
aws rds wait db-snapshot-completed `
  --db-snapshot-identifier $snapshotName `
  --region $region

npx cdk diff -c opsAlertEmail=operations@example.org
```

Abort if CDK proposes replacing the RDS instance, database credential secret,
or ECS service.

To change the season, pass all four schedule contexts to both `cdk diff` and
`cdk deploy`; values in `cdk.json` remain the defaults:

```powershell
npx cdk diff `
  -c opsAlertEmail=operations@example.org `
  -c seasonWakeMonthDay=02-01 `
  -c seasonHibernateMonthDay=08-01 `
  -c seasonTransitionTime=08:00 `
  -c seasonTimeZone=America/New_York
```

### Post-deploy activation and manual operations

Confirm the SNS subscription email, then run reconciliation:

```powershell
$outputs = aws cloudformation describe-stacks `
  --stack-name BycCampDevStack `
  --region us-east-2 `
  --query "Stacks[0].Outputs" `
  --output json | ConvertFrom-Json

$stateMachineArn = ($outputs | Where-Object OutputKey -eq "SeasonalControllerStateMachineArn").OutputValue
$modeParameter = ($outputs | Where-Object OutputKey -eq "SeasonalModeParameterName").OutputValue
$inputJson = @{ operation = "RECONCILE"; source = "operator" } |
  ConvertTo-Json -Compress

aws stepfunctions start-execution `
  --state-machine-arn $stateMachineArn `
  --input $inputJson `
  --region us-east-2

aws ssm get-parameter --name $modeParameter --region us-east-2
```

Change `operation` to `HIBERNATE`, `MAINTENANCE`, or `WAKE` for an approved
manual test. Repeated operations are idempotent. `WAKE` does not restore public
traffic until RDS is available, ECS has a running task, and the ALB target is
healthy.

If an execution is aborted while the SSM mode is transitional, first confirm
that no controller execution is still running. Inspect its execution history
and CloudWatch error log, correct the cause, set the mode to `ERROR`, and run
an explicit `WAKE` or `HIBERNATE`:

```powershell
aws stepfunctions list-executions `
  --state-machine-arn $stateMachineArn `
  --status-filter RUNNING `
  --region us-east-2

aws ssm put-parameter `
  --name $modeParameter `
  --type String `
  --value ERROR `
  --overwrite `
  --region us-east-2
```

At least once per year, restore a retained snapshot to a temporary RDS
instance and verify expected tables and recent camp records. Remove the
temporary instance only after documenting a successful restore.

## Destroy

```bash
npx cdk destroy -c opsAlertEmail=operations@example.org
```

Deletion protection intentionally blocks destruction of RDS. Do not disable it
until a verified snapshot exists and database removal is explicitly intended.
After deletion protection is deliberately disabled, CloudFormation creates a
final snapshot; retained secrets and automated backups require separate,
explicit cleanup after a recovery check.
