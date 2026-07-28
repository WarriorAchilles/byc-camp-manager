import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as customResources from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import { SeasonalOperations } from "./seasonal-operations";

export class BycCampDevStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC },
        { name: "Private", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      description: "ALB ingress",
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP from internet");
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS from internet");

    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc,
      description: "Fargate tasks",
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(4000), "ALB to app");

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      description: "RDS PostgreSQL",
      allowAllOutbound: false,
    });
    dbSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(5432), "ECS to Postgres");

    const jwtSecret = new secretsmanager.Secret(this, "JwtSecret", {
      description: "JWT signing secret for BYC Camp Manager admin sessions",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "token",
        excludeCharacters: " %+~`#$&*()|[]{}:;<>?!/=\\'\"@",
        passwordLength: 48,
        requireEachIncludedType: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const prismaDatabaseUrlSecret = new secretsmanager.Secret(this, "PrismaDatabaseUrl", {
      description: "Prisma DATABASE_URL (replaced by DatabaseUrlSync custom resource)",
      secretStringValue: cdk.SecretValue.unsafePlainText(
        "postgresql://sync:sync@127.0.0.1:5432/sync?schema=public&sslmode=require",
      ),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      databaseName: "byc_camp",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: "05:00-05:30",
      preferredMaintenanceWindow: "sun:06:00-sun:06:30",
      deleteAutomatedBackups: false,
      publiclyAccessible: false,
      securityGroups: [dbSecurityGroup],
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      deletionProtection: true,
    });
    const generatedDatabaseSecret = database.node.findChild("Secret") as cdk.Resource;
    generatedDatabaseSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const databaseUrlSyncLogGroup = new logs.LogGroup(this, "DatabaseUrlSyncLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const databaseUrlSyncFn = new NodejsFunction(this, "DatabaseUrlSyncFn", {
      entry: path.join(__dirname, "../lambda/database-url-sync.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      logGroup: databaseUrlSyncLogGroup,
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });
    database.secret!.grantRead(databaseUrlSyncFn);
    prismaDatabaseUrlSecret.grantWrite(databaseUrlSyncFn);

    const databaseUrlProvider = new customResources.Provider(this, "DatabaseUrlProvider", {
      onEventHandler: databaseUrlSyncFn,
    });

    const databaseUrlResource = new cdk.CustomResource(this, "DatabaseUrlResource", {
      serviceToken: databaseUrlProvider.serviceToken,
      resourceType: "Custom::BycPrismaDatabaseUrlSync",
      properties: {
        RdsSecretArn: database.secret!.secretArn,
        TargetSecretArn: prismaDatabaseUrlSecret.secretArn,
      },
    });
    databaseUrlResource.node.addDependency(database);

    const usePlaceholderImage = this.node.tryGetContext("usePlaceholderImage") === "true";

    const configuredAdminPublicOrigin = this.node.tryGetContext("adminPublicOrigin");
    if (configuredAdminPublicOrigin === undefined) {
      throw new Error("adminPublicOrigin CDK context is required");
    }
    const adminPublicOrigin = String(configuredAdminPublicOrigin);
    const configuredRegistrationPublicOrigin = this.node.tryGetContext("registrationPublicOrigin");
    if (configuredRegistrationPublicOrigin === undefined) {
      throw new Error("registrationPublicOrigin CDK context is required");
    }
    const registrationPublicOrigin = String(configuredRegistrationPublicOrigin);
    if (registrationPublicOrigin === adminPublicOrigin) {
      throw new Error("adminPublicOrigin and registrationPublicOrigin must be different");
    }

    const imageAsset = usePlaceholderImage
      ? undefined
      : new ecr_assets.DockerImageAsset(this, "AppImage", {
          directory: path.join(__dirname, "..", "..", ".."),
          file: "deploy/Dockerfile",
          platform: ecr_assets.Platform.LINUX_ARM64,
          buildArgs: { VITE_REGISTRATION_PUBLIC_ORIGIN: registrationPublicOrigin },
        });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
    });

    const logGroup = new logs.LogGroup(this, "AppLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const configuredCertificateArn = this.node.tryGetContext("certificateArn");
    const certificate =
      configuredCertificateArn === undefined
        ? undefined
        : acm.Certificate.fromCertificateArn(
            this,
            "AdminCertificate",
            String(configuredCertificateArn),
          );
    const stripeSecretKeySecretArn = this.node.tryGetContext("stripeSecretKeySecretArn");
    const stripeWebhookSecretArn = this.node.tryGetContext("stripeWebhookSecretArn");
    const initialSuperAdminSecretArn = this.node.tryGetContext("initialSuperAdminSecretArn");
    const optionalStripeSecrets: Record<string, ecs.Secret> = {};
    const stripeSecretKey =
      stripeSecretKeySecretArn === undefined
        ? undefined
        : secretsmanager.Secret.fromSecretCompleteArn(
            this,
            "StripeSecretKey",
            String(stripeSecretKeySecretArn),
          );
    const stripeWebhookSecret =
      stripeWebhookSecretArn === undefined
        ? undefined
        : secretsmanager.Secret.fromSecretCompleteArn(
            this,
            "StripeWebhookSecret",
            String(stripeWebhookSecretArn),
          );
    if (stripeSecretKey) {
      optionalStripeSecrets.STRIPE_SECRET_KEY = ecs.Secret.fromSecretsManager(stripeSecretKey);
    }
    if (stripeWebhookSecret) {
      optionalStripeSecrets.STRIPE_WEBHOOK_SECRET = ecs.Secret.fromSecretsManager(stripeWebhookSecret);
    }
    const initialSuperAdminSecret =
      initialSuperAdminSecretArn === undefined
        ? undefined
        : secretsmanager.Secret.fromSecretCompleteArn(
            this,
            "InitialSuperAdminSecret",
            String(initialSuperAdminSecretArn),
          );
    const optionalBootstrapSecrets: Record<string, ecs.Secret> = {};
    if (initialSuperAdminSecret) {
      optionalBootstrapSecrets.INITIAL_SUPER_ADMIN_SECRET_JSON =
        ecs.Secret.fromSecretsManager(initialSuperAdminSecret);
    }

    const container = taskDefinition.addContainer("web", {
      image: usePlaceholderImage
        ? ecs.ContainerImage.fromRegistry("public.ecr.aws/docker/library/node:22-bookworm-slim")
        : ecs.ContainerImage.fromDockerImageAsset(imageAsset!),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "byc",
        logGroup,
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "4000",
        ADMIN_PUBLIC_ORIGIN: adminPublicOrigin,
        REGISTRATION_PUBLIC_ORIGIN: registrationPublicOrigin,
        TRUST_PROXY_HOPS: "1",
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(prismaDatabaseUrlSecret),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, "token"),
        ...optionalStripeSecrets,
        ...optionalBootstrapSecrets,
      },
    });
    container.addPortMappings({ containerPort: 4000, protocol: ecs.Protocol.TCP });

    jwtSecret.grantRead(taskDefinition.executionRole!);
    prismaDatabaseUrlSecret.grantRead(taskDefinition.executionRole!);
    stripeSecretKey?.grantRead(taskDefinition.executionRole!);
    stripeWebhookSecret?.grantRead(taskDefinition.executionRole!);
    initialSuperAdminSecret?.grantRead(taskDefinition.executionRole!);
    if (!usePlaceholderImage) {
      imageAsset!.repository.grantPull(taskDefinition.executionRole!);
    }

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [ecsSecurityGroup],
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
    });
    service.node.addDependency(databaseUrlResource);

    const targetGroup = new elbv2.ApplicationTargetGroup(this, "AppTg", {
      vpc,
      port: 4000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/api/health",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(10),
    });
    targetGroup.addTarget(
      service.loadBalancerTarget({
        containerName: "web",
        containerPort: 4000,
      }),
    );

    const closedSeasonPage = [
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      "<title>Believer's Youth Camp</title></head><body>",
      "<main><h1>Registration is closed for the season</h1>",
      "<p>The BYC registration and administration system is currently offline. ",
      "Please check back when the next registration season opens.</p></main></body></html>",
    ].join("");
    const closedSeasonAction = elbv2.ListenerAction.fixedResponse(503, {
      contentType: "text/html",
      messageBody: closedSeasonPage,
    });

    let applicationListener: elbv2.ApplicationListener;
    if (certificate) {
      applicationListener = loadBalancer.addListener("HttpsListener", {
        port: 443,
        open: false,
        certificates: [certificate],
        defaultAction: closedSeasonAction,
      });

      loadBalancer.addListener("HttpListener", {
        port: 80,
        open: false,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true,
        }),
      });
    } else {
      applicationListener = loadBalancer.addListener("HttpListener", {
        port: 80,
        open: false,
        defaultAction: closedSeasonAction,
      });
    }

    const activeSeasonRule = new elbv2.ApplicationListenerRule(this, "ActiveSeasonRule", {
      listener: applicationListener,
      priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/*"])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });

    const opsAlertEmail = this.node.tryGetContext("opsAlertEmail");
    if (opsAlertEmail === undefined) {
      throw new Error("opsAlertEmail CDK context is required");
    }
    const seasonalOperations = new SeasonalOperations(this, "SeasonalOperations", {
      database,
      cluster,
      service,
      targetGroup,
      activeSeasonRule,
      schedule: {
        wakeMonthDay: String(
          this.node.tryGetContext("seasonWakeMonthDay") ?? "02-01",
        ),
        hibernateMonthDay: String(
          this.node.tryGetContext("seasonHibernateMonthDay") ?? "08-01",
        ),
        transitionTime: String(
          this.node.tryGetContext("seasonTransitionTime") ?? "08:00",
        ),
        timeZone: String(
          this.node.tryGetContext("seasonTimeZone") ?? "America/New_York",
        ),
        alertEmail: String(opsAlertEmail),
      },
    });

    new cdk.CfnOutput(this, "LoadBalancerDns", {
      value: loadBalancer.loadBalancerDnsName,
      description: "Open http://(this value) for the admin app",
    });
    new cdk.CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: service.serviceName });
    new cdk.CfnOutput(this, "TaskDefinitionArn", { value: taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new cdk.CfnOutput(this, "PublicSubnetIds", {
      value: vpc.publicSubnets.map((subnet: ec2.ISubnet) => subnet.subnetId).join(","),
    });
    new cdk.CfnOutput(this, "EcsSecurityGroupId", { value: ecsSecurityGroup.securityGroupId });
    new cdk.CfnOutput(this, "PrismaDatabaseUrlSecretArn", {
      value: prismaDatabaseUrlSecret.secretArn,
    });
    new cdk.CfnOutput(this, "JwtSecretArn", { value: jwtSecret.secretArn });
    new cdk.CfnOutput(this, "RdsSecretArn", { value: database.secret!.secretArn });
    new cdk.CfnOutput(this, "EcrImageUri", {
      value: usePlaceholderImage ? "(placeholder image — set usePlaceholderImage=false for real build)" : imageAsset!.imageUri,
    });
    new cdk.CfnOutput(this, "SeasonalControllerStateMachineArn", {
      value: seasonalOperations.stateMachineArn,
    });
    new cdk.CfnOutput(this, "SeasonalModeParameterName", {
      value: seasonalOperations.stateParameterName,
    });
    new cdk.CfnOutput(this, "SeasonalAlertTopicArn", {
      value: seasonalOperations.alertTopicArn,
    });
    new cdk.CfnOutput(this, "SeasonalScheduleDeadLetterQueueUrl", {
      value: seasonalOperations.deadLetterQueueUrl,
    });
    new cdk.CfnOutput(this, "SeasonWakeScheduleName", {
      value: seasonalOperations.scheduleNames.wake,
    });
    new cdk.CfnOutput(this, "SeasonHibernateScheduleName", {
      value: seasonalOperations.scheduleNames.hibernate,
    });
    new cdk.CfnOutput(this, "OffseasonMaintenanceScheduleName", {
      value: seasonalOperations.scheduleNames.maintenance,
    });
    new cdk.CfnOutput(this, "SeasonReconcileScheduleName", {
      value: seasonalOperations.scheduleNames.reconcile,
    });

    new cdk.CfnOutput(this, "MigrateRunTaskHint", {
      value:
        "Run Prisma migrations once: see infra/README.md (aws ecs run-task) using ClusterName, TaskDefinitionArn, PublicSubnetIds, EcsSecurityGroupId.",
    });
  }
}
