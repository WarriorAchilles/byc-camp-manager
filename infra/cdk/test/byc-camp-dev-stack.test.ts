import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { BycCampDevStack } from "../lib/byc-camp-dev-stack";

function createStack(extraContext: Record<string, string> = {}): BycCampDevStack {
  const app = new cdk.App({
    context: {
      usePlaceholderImage: "true",
      adminPublicOrigin: "https://admin.example.org",
      registrationPublicOrigin: "https://registration.example.org",
      opsAlertEmail: "ops@example.org",
      seasonWakeMonthDay: "02-01",
      seasonHibernateMonthDay: "08-01",
      seasonTransitionTime: "08:00",
      seasonTimeZone: "America/New_York",
      ...extraContext,
    },
  });

  return new BycCampDevStack(app, "TestBycCampStack", {
    env: { account: "111122223333", region: "us-east-2" },
  });
}

describe("BYC database protection", () => {
  it("retains recovery data and protects the RDS instance", () => {
    const template = Template.fromStack(createStack());

    template.hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Snapshot",
      UpdateReplacePolicy: "Snapshot",
      Properties: {
        BackupRetentionPeriod: 7,
        PreferredBackupWindow: "05:00-05:30",
        PreferredMaintenanceWindow: "sun:06:00-sun:06:30",
        DeleteAutomatedBackups: false,
        DeletionProtection: true,
        CopyTagsToSnapshot: true,
      },
    });

    const secrets = template.findResources("AWS::SecretsManager::Secret");
    expect(Object.values(secrets)).toHaveLength(3);
    for (const secret of Object.values(secrets)) {
      expect(secret.DeletionPolicy).toBe("Retain");
      expect(secret.UpdateReplacePolicy).toBe("Retain");
    }

    const databases = Object.values(template.findResources("AWS::RDS::DBInstance"));
    expect(databases[0].Properties).not.toHaveProperty("StorageEncrypted");
  });
});

describe("BYC seasonal traffic and compute", () => {
  it("leaves desired count to the seasonal controller", () => {
    const template = Template.fromStack(createStack());
    const services = Object.values(template.findResources("AWS::ECS::Service"));
    expect(services).toHaveLength(1);
    expect(services[0].Properties).not.toHaveProperty("DesiredCount");
  });

  it("uses a closed-season default response and an active forwarding rule", () => {
    const template = Template.fromStack(createStack());

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      DefaultActions: [
        {
          Type: "fixed-response",
          FixedResponseConfig: {
            StatusCode: "503",
            ContentType: "text/html",
            MessageBody: Match.stringLikeRegexp("Registration is closed for the season"),
          },
        },
      ],
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
      Priority: 1,
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: { Values: ["/*"] },
        },
      ],
      Actions: [Match.objectLike({ Type: "forward" })],
    });
  });
});

describe("BYC seasonal controller", () => {
  it("creates all schedules, state, alerts, and a dead-letter queue", () => {
    const template = Template.fromStack(createStack());

    template.resourceCountIs("AWS::Scheduler::Schedule", 4);
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 8 1 2 ? *)",
      ScheduleExpressionTimezone: "America/New_York",
      Target: Match.objectLike({
        Input: JSON.stringify({ operation: "WAKE", source: "schedule" }),
        RetryPolicy: {
          MaximumEventAgeInSeconds: 3600,
          MaximumRetryAttempts: 3,
        },
      }),
    });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 8 1 8 ? *)",
      ScheduleExpressionTimezone: "America/New_York",
      Target: Match.objectLike({
        Input: JSON.stringify({ operation: "HIBERNATE", source: "schedule" }),
      }),
    });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 4 ? * SUN *)",
      ScheduleExpressionTimezone: "UTC",
      Target: Match.objectLike({
        Input: JSON.stringify({ operation: "MAINTENANCE", source: "schedule" }),
      }),
    });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 10 * * ? *)",
      ScheduleExpressionTimezone: "UTC",
      Target: Match.objectLike({
        Input: JSON.stringify({ operation: "RECONCILE", source: "schedule" }),
      }),
    });

    template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      LoggingConfiguration: {
        IncludeExecutionData: false,
        Level: "ERROR",
        Destinations: [
          {
            CloudWatchLogsLogGroup: {
              LogGroupArn: {
                "Fn::GetAtt": [
                  Match.stringLikeRegexp("SeasonalControllerLogs"),
                  "Arn",
                ],
              },
            },
          },
        ],
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Type: "String",
      Value: "ACTIVE",
      Description: "Authoritative BYC seasonal controller mode",
    });
    template.resourceCountIs("AWS::SQS::Queue", 1);
    template.hasResourceProperties("AWS::SQS::Queue", {
      SqsManagedSseEnabled: true,
    });
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "ops@example.org",
    });
    template.resourceCountIs("AWS::RDS::EventSubscription", 1);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);

    const schedules = Object.values(
      template.findResources("AWS::Scheduler::Schedule"),
    );
    for (const schedule of schedules) {
      expect(schedule.Properties.Target).toEqual(
        expect.objectContaining({
          DeadLetterConfig: { Arn: expect.anything() },
          RoleArn: expect.anything(),
        }),
      );
    }

    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap(
      (policy) => policy.Properties.PolicyDocument.Statement as Array<{
        Action: string | string[];
        Resource: unknown;
      }>,
    );
    for (const action of [
      "states:StartExecution",
      "sqs:SendMessage",
      "ecs:UpdateService",
      "rds:StartDBInstance",
      "rds:StopDBInstance",
      "elasticloadbalancing:ModifyRule",
      "ssm:PutParameter",
    ]) {
      const statement = statements.find((candidate) =>
        (Array.isArray(candidate.Action) ? candidate.Action : [candidate.Action]).includes(
          action,
        ),
      );
      expect(statement, `${action} policy statement`).toBeDefined();
      expect(statement?.Resource).not.toBe("*");
    }

    const key = Object.values(template.findResources("AWS::KMS::Key"))[0];
    const keyPolicy = JSON.stringify(key.Properties.KeyPolicy);
    expect(keyPolicy).toContain("events.amazonaws.com");
    expect(keyPolicy).toContain("cloudwatch.amazonaws.com");
    expect(keyPolicy).toContain("events.rds.amazonaws.com");

    const outputs = Object.keys(template.toJSON().Outputs);
    expect(outputs).toEqual(
      expect.arrayContaining([
        "SeasonalControllerStateMachineArn",
        "SeasonalModeParameterName",
        "SeasonalAlertTopicArn",
        "SeasonalScheduleDeadLetterQueueUrl",
        "SeasonWakeScheduleName",
        "SeasonHibernateScheduleName",
        "OffseasonMaintenanceScheduleName",
        "SeasonReconcileScheduleName",
      ]),
    );
  });

  it("closes traffic before draining and opens it only after target health", () => {
    const template = Template.fromStack(createStack());
    const stateMachines = Object.values(
      template.findResources("AWS::StepFunctions::StateMachine"),
    );
    const definition = JSON.parse(stateMachines[0].Properties.DefinitionString) as {
      States: Record<string, Record<string, unknown>>;
    };

    expect(definition.States["Set hibernating mode"].Next).toBe("Close traffic");
    expect(definition.States["Close traffic"].Next).toBe("Hibernate ECS update");
    expect(definition.States["Hibernate ECS check"]).toMatchObject({
      Type: "Choice",
      Choices: expect.arrayContaining([
        expect.objectContaining({
          And: expect.arrayContaining([
            expect.objectContaining({
              Variable: "$.ecs.Services[0].RunningCount",
              NumericEquals: 0,
            }),
            expect.objectContaining({
              Variable: "$.ecs.Services[0].PendingCount",
              NumericEquals: 0,
            }),
          ]),
        }),
      ]),
    });
    expect(definition.States["Wake ECS check"]).toMatchObject({
      Type: "Choice",
      Choices: expect.arrayContaining([
        expect.objectContaining({ Next: "Wake target initialize" }),
      ]),
    });
    expect(definition.States["Wake target check"]).toMatchObject({
      Type: "Choice",
      Choices: expect.arrayContaining([
        expect.objectContaining({ Next: "Open traffic" }),
      ]),
    });
    expect(definition.States["Hold for backup and maintenance"]).toMatchObject({
      Type: "Wait",
      Seconds: 14400,
    });
    expect(definition.States["Compensate close traffic"]).toBeDefined();
    expect(definition.States["Set error mode"]).toBeDefined();
  });

  it("uses Step Functions parameter casing for every RDS SDK task", () => {
    const template = Template.fromStack(createStack());
    const stateMachines = Object.values(
      template.findResources("AWS::StepFunctions::StateMachine"),
    );
    const definition = JSON.parse(stateMachines[0].Properties.DefinitionString) as {
      States: Record<
        string,
        { Resource?: string; Parameters?: Record<string, unknown> }
      >;
    };
    const rdsTasks = Object.values(definition.States).filter((state) =>
      state.Resource?.startsWith("arn:aws:states:::aws-sdk:rds:"),
    );

    expect(rdsTasks).toHaveLength(10);
    for (const task of rdsTasks) {
      expect(task.Parameters).toHaveProperty(
        "DbInstanceIdentifier",
        "${DatabaseIdentifier}",
      );
      expect(task.Parameters).not.toHaveProperty("DBInstanceIdentifier");
    }
  });

  it("uses Step Functions response casing and guards missing RDS status paths", () => {
    const template = Template.fromStack(createStack());
    const stateMachines = Object.values(
      template.findResources("AWS::StepFunctions::StateMachine"),
    );
    const definition = JSON.parse(stateMachines[0].Properties.DefinitionString) as {
      States: Record<
        string,
        { Type: string; Choices?: Array<Record<string, unknown>> }
      >;
    };
    const rdsCheckStateNames = [
      "Wake RDS check",
      "Hibernate RDS check",
      "Maintenance RDS start check",
      "Maintenance RDS stop check",
    ];

    for (const stateName of rdsCheckStateNames) {
      expect(definition.States[stateName].Choices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Variable: "$.rds.DbInstances[0].DbInstanceStatus",
            IsPresent: false,
            Next: "Compensate close traffic",
          }),
        ]),
      );
    }

    expect(definition.States["Compensate RDS choice"].Choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Variable: "$.compensationRds.DbInstances[0].DbInstanceStatus",
          IsPresent: false,
          Next: "Set error mode",
        }),
      ]),
    );

    const serializedDefinition = JSON.stringify(definition);
    expect(serializedDefinition).not.toContain(".DBInstances");
    expect(serializedDefinition).not.toContain(".DBInstanceStatus");
  });

  it("validates human-readable seasonal context", () => {
    expect(() => createStack({ seasonWakeMonthDay: "02-31" })).toThrow(
      "seasonWakeMonthDay must be a valid calendar date",
    );
    expect(() => createStack({ seasonTransitionTime: "25:00" })).toThrow(
      "seasonTransitionTime must be a valid 24-hour time",
    );
    expect(() => createStack({ seasonTimeZone: "Eastern-ish" })).toThrow(
      "seasonTimeZone must be a valid IANA time zone",
    );
  });
});
