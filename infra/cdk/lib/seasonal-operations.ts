import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Construct } from "constructs";

export interface SeasonalScheduleConfig {
  readonly wakeMonthDay: string;
  readonly hibernateMonthDay: string;
  readonly transitionTime: string;
  readonly timeZone: string;
  readonly alertEmail: string;
}

export interface SeasonalOperationsProps {
  readonly database: rds.DatabaseInstance;
  readonly cluster: ecs.Cluster;
  readonly service: ecs.FargateService;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  readonly activeSeasonRule: elbv2.ApplicationListenerRule;
  readonly schedule: SeasonalScheduleConfig;
}

type StateDefinition = Record<string, unknown>;
type StateMap = Record<string, StateDefinition>;

const RETRY = [
  {
    ErrorEquals: ["States.ALL"],
    IntervalSeconds: 5,
    MaxAttempts: 3,
    BackoffRate: 2,
  },
];

const FAILURE_STATE = "Compensate close traffic";
const ACTIVE_PATH = "/*";
const INACTIVE_PATH = "/__byc-off-season-disabled__";

function parseMonthDay(value: string, fieldName: string): { month: number; day: number } {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${fieldName} must use MM-DD format`);
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const parsed = new Date(Date.UTC(2024, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return { month, day };
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("seasonTransitionTime must use HH:mm format");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error("seasonTransitionTime must be a valid 24-hour time");
  }

  return { hour, minute };
}

function validateTimeZone(value: string): void {
  if (!value.trim()) {
    throw new Error("seasonTimeZone is required");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("seasonTimeZone must be a valid IANA time zone");
  }
}

function awsSdkTask(
  resource: string,
  parameters: Record<string, unknown>,
  next: string,
  resultPath: string | null = null,
): StateDefinition {
  return {
    Type: "Task",
    Resource: resource,
    Parameters: parameters,
    ResultPath: resultPath,
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.failure", Next: FAILURE_STATE }],
    Next: next,
  };
}

function putMode(mode: string, next: string): StateDefinition {
  return awsSdkTask(
    "arn:aws:states:::aws-sdk:ssm:putParameter",
    {
      Name: "${StateParameterName}",
      Value: mode,
      Type: "String",
      Overwrite: true,
    },
    next,
  );
}

function addCounter(states: StateMap, prefix: string, describeState: string): void {
  states[`${prefix} wait`] = {
    Type: "Wait",
    Seconds: 60,
    Next: `${prefix} increment`,
  };
  states[`${prefix} increment`] = {
    Type: "Pass",
    Parameters: {
      "Attempts.$": "States.MathAdd($.poll.Attempts, 1)",
    },
    ResultPath: "$.poll",
    Next: describeState,
  };
}

function addEnsureRdsAvailable(
  states: StateMap,
  prefix: string,
  successNext: string,
): string {
  const initialize = `${prefix} initialize`;
  const describe = `${prefix} describe`;
  const choice = `${prefix} check`;
  const start = `${prefix} start`;

  states[initialize] = {
    Type: "Pass",
    Result: { Attempts: 0 },
    ResultPath: "$.poll",
    Next: describe,
  };
  states[describe] = awsSdkTask(
    "arn:aws:states:::aws-sdk:rds:describeDBInstances",
    { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    choice,
    "$.rds",
  );
  states[choice] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.rds.DBInstances[0].DBInstanceStatus",
        StringEquals: "available",
        Next: successNext,
      },
      {
        Variable: "$.poll.Attempts",
        NumericGreaterThanEquals: 90,
        Next: FAILURE_STATE,
      },
      {
        Variable: "$.rds.DBInstances[0].DBInstanceStatus",
        StringEquals: "stopped",
        Next: start,
      },
    ],
    Default: `${prefix} wait`,
  };
  states[start] = awsSdkTask(
    "arn:aws:states:::aws-sdk:rds:startDBInstance",
    { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    `${prefix} wait`,
  );
  addCounter(states, prefix, describe);
  return initialize;
}

function addEnsureRdsStopped(
  states: StateMap,
  prefix: string,
  successNext: string,
): string {
  const initialize = `${prefix} initialize`;
  const describe = `${prefix} describe`;
  const choice = `${prefix} check`;
  const stop = `${prefix} stop`;

  states[initialize] = {
    Type: "Pass",
    Result: { Attempts: 0 },
    ResultPath: "$.poll",
    Next: describe,
  };
  states[describe] = awsSdkTask(
    "arn:aws:states:::aws-sdk:rds:describeDBInstances",
    { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    choice,
    "$.rds",
  );
  states[choice] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.rds.DBInstances[0].DBInstanceStatus",
        StringEquals: "stopped",
        Next: successNext,
      },
      {
        Variable: "$.poll.Attempts",
        NumericGreaterThanEquals: 90,
        Next: FAILURE_STATE,
      },
      {
        Variable: "$.rds.DBInstances[0].DBInstanceStatus",
        StringEquals: "available",
        Next: stop,
      },
    ],
    Default: `${prefix} wait`,
  };
  states[stop] = awsSdkTask(
    "arn:aws:states:::aws-sdk:rds:stopDBInstance",
    { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    `${prefix} wait`,
  );
  addCounter(states, prefix, describe);
  return initialize;
}

function addEnsureEcsCount(
  states: StateMap,
  prefix: string,
  desiredCount: number,
  maxAttempts: number,
  successNext: string,
): string {
  const update = `${prefix} update`;
  const initialize = `${prefix} initialize`;
  const describe = `${prefix} describe`;
  const choice = `${prefix} check`;

  states[update] = awsSdkTask(
    "arn:aws:states:::aws-sdk:ecs:updateService",
    {
      Cluster: "${ClusterArn}",
      Service: "${ServiceArn}",
      DesiredCount: desiredCount,
    },
    initialize,
  );
  states[initialize] = {
    Type: "Pass",
    Result: { Attempts: 0 },
    ResultPath: "$.poll",
    Next: describe,
  };
  states[describe] = awsSdkTask(
    "arn:aws:states:::aws-sdk:ecs:describeServices",
    {
      Cluster: "${ClusterArn}",
      Services: ["${ServiceArn}"],
    },
    choice,
    "$.ecs",
  );
  states[choice] = {
    Type: "Choice",
    Choices: [
      {
        And: [
          {
            Variable: "$.ecs.Services[0].RunningCount",
            NumericEquals: desiredCount,
          },
          ...(desiredCount === 0
            ? [
                {
                  Variable: "$.ecs.Services[0].PendingCount",
                  NumericEquals: 0,
                },
              ]
            : []),
        ],
        Next: successNext,
      },
      {
        Variable: "$.poll.Attempts",
        NumericGreaterThanEquals: maxAttempts,
        Next: FAILURE_STATE,
      },
    ],
    Default: `${prefix} wait`,
  };
  addCounter(states, prefix, describe);
  return update;
}

function addWaitForHealthyTarget(
  states: StateMap,
  prefix: string,
  successNext: string,
): string {
  const initialize = `${prefix} initialize`;
  const describe = `${prefix} describe`;
  const choice = `${prefix} check`;

  states[initialize] = {
    Type: "Pass",
    Result: { Attempts: 0 },
    ResultPath: "$.poll",
    Next: describe,
  };
  states[describe] = awsSdkTask(
    "arn:aws:states:::aws-sdk:elasticloadbalancingv2:describeTargetHealth",
    { TargetGroupArn: "${TargetGroupArn}" },
    choice,
    "$.targetHealth",
  );
  states[choice] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.targetHealth.TargetHealthDescriptions[0].TargetHealth.State",
        StringEquals: "healthy",
        Next: successNext,
      },
      {
        Variable: "$.poll.Attempts",
        NumericGreaterThanEquals: 20,
        Next: FAILURE_STATE,
      },
    ],
    Default: `${prefix} wait`,
  };
  addCounter(states, prefix, describe);
  return initialize;
}

function buildStateMachineDefinition(): Record<string, unknown> {
  const states: StateMap = {};

  const wakeTargetHealth = addWaitForHealthyTarget(states, "Wake target", "Open traffic");
  const wakeEcs = addEnsureEcsCount(states, "Wake ECS", 1, 20, wakeTargetHealth);
  const wakeRds = addEnsureRdsAvailable(states, "Wake RDS", wakeEcs);

  const hibernateRds = addEnsureRdsStopped(
    states,
    "Hibernate RDS",
    "Set hibernated mode",
  );
  const hibernateEcs = addEnsureEcsCount(
    states,
    "Hibernate ECS",
    0,
    15,
    hibernateRds,
  );

  const maintenanceRdsStop = addEnsureRdsStopped(
    states,
    "Maintenance RDS stop",
    "Set hibernated mode",
  );
  const maintenanceRdsStart = addEnsureRdsAvailable(
    states,
    "Maintenance RDS start",
    "Hold for backup and maintenance",
  );

  states["Get seasonal mode"] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:ssm:getParameter",
    Parameters: { Name: "${StateParameterName}" },
    ResultSelector: { "Value.$": "$.Parameter.Value" },
    ResultPath: "$.controllerState",
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], ResultPath: "$.failure", Next: FAILURE_STATE }],
    Next: "Validate source",
  };
  states["Validate source"] = {
    Type: "Choice",
    Choices: [
      { Variable: "$.source", StringEquals: "schedule", Next: "Route operation" },
      { Variable: "$.source", StringEquals: "operator", Next: "Route operation" },
    ],
    Default: "Invalid source",
  };
  states["Route operation"] = {
    Type: "Choice",
    Choices: [
      { Variable: "$.operation", StringEquals: "WAKE", Next: "Check wake mode" },
      {
        Variable: "$.operation",
        StringEquals: "HIBERNATE",
        Next: "Check hibernate mode",
      },
      {
        Variable: "$.operation",
        StringEquals: "MAINTENANCE",
        Next: "Check maintenance mode",
      },
      {
        Variable: "$.operation",
        StringEquals: "RECONCILE",
        Next: "Check reconcile mode",
      },
    ],
    Default: "Invalid operation",
  };

  states["Check wake mode"] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.controllerState.Value",
        StringEquals: "ACTIVE",
        Next: "Operation already satisfied",
      },
      {
        Variable: "$.controllerState.Value",
        StringEquals: "HIBERNATED",
        Next: "Set waking mode",
      },
      {
        Variable: "$.controllerState.Value",
        StringEquals: "ERROR",
        Next: "Set waking mode",
      },
    ],
    Default: "Operation skipped",
  };
  states["Set waking mode"] = putMode("WAKING", wakeRds);
  states["Open traffic"] = awsSdkTask(
    "arn:aws:states:::aws-sdk:elasticloadbalancingv2:modifyRule",
    {
      RuleArn: "${ActiveRuleArn}",
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: { Values: [ACTIVE_PATH] },
        },
      ],
    },
    "Set active mode",
  );
  states["Set active mode"] = putMode("ACTIVE", "Operation complete");

  states["Check hibernate mode"] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.controllerState.Value",
        StringEquals: "HIBERNATED",
        Next: "Operation already satisfied",
      },
      {
        Variable: "$.controllerState.Value",
        StringEquals: "ACTIVE",
        Next: "Set hibernating mode",
      },
      {
        Variable: "$.controllerState.Value",
        StringEquals: "ERROR",
        Next: "Set hibernating mode",
      },
    ],
    Default: "Operation skipped",
  };
  states["Set hibernating mode"] = putMode("HIBERNATING", "Close traffic");
  states["Close traffic"] = awsSdkTask(
    "arn:aws:states:::aws-sdk:elasticloadbalancingv2:modifyRule",
    {
      RuleArn: "${ActiveRuleArn}",
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: { Values: [INACTIVE_PATH] },
        },
      ],
    },
    hibernateEcs,
  );
  states["Set hibernated mode"] = putMode("HIBERNATED", "Operation complete");

  states["Check maintenance mode"] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.controllerState.Value",
        StringEquals: "HIBERNATED",
        Next: "Set maintenance mode",
      },
    ],
    Default: "Operation skipped",
  };
  states["Set maintenance mode"] = putMode("MAINTENANCE", maintenanceRdsStart);
  states["Hold for backup and maintenance"] = {
    Type: "Wait",
    Seconds: 14400,
    Next: maintenanceRdsStop,
  };

  states["Check reconcile mode"] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.controllerState.Value",
        StringEquals: "ACTIVE",
        Next: wakeRds,
      },
      {
        Variable: "$.controllerState.Value",
        StringEquals: "HIBERNATED",
        Next: "Close traffic",
      },
    ],
    Default: "Operation skipped",
  };

  states[FAILURE_STATE] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:elasticloadbalancingv2:modifyRule",
    Parameters: {
      RuleArn: "${ActiveRuleArn}",
      Conditions: [
        {
          Field: "path-pattern",
          PathPatternConfig: { Values: [INACTIVE_PATH] },
        },
      ],
    },
    ResultPath: null,
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], Next: "Compensate scale ECS down" }],
    Next: "Compensate scale ECS down",
  };
  states["Compensate scale ECS down"] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:ecs:updateService",
    Parameters: {
      Cluster: "${ClusterArn}",
      Service: "${ServiceArn}",
      DesiredCount: 0,
    },
    ResultPath: null,
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], Next: "Compensate inspect RDS" }],
    Next: "Compensate inspect RDS",
  };
  states["Compensate inspect RDS"] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:rds:describeDBInstances",
    Parameters: { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    ResultPath: "$.compensationRds",
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], Next: "Set error mode" }],
    Next: "Compensate RDS choice",
  };
  states["Compensate RDS choice"] = {
    Type: "Choice",
    Choices: [
      {
        Variable: "$.compensationRds.DBInstances[0].DBInstanceStatus",
        StringEquals: "available",
        Next: "Compensate stop RDS",
      },
    ],
    Default: "Set error mode",
  };
  states["Compensate stop RDS"] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:rds:stopDBInstance",
    Parameters: { DbInstanceIdentifier: "${DatabaseIdentifier}" },
    ResultPath: null,
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], Next: "Set error mode" }],
    Next: "Set error mode",
  };
  states["Set error mode"] = {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:ssm:putParameter",
    Parameters: {
      Name: "${StateParameterName}",
      Value: "ERROR",
      Type: "String",
      Overwrite: true,
    },
    ResultPath: null,
    Retry: RETRY,
    Catch: [{ ErrorEquals: ["States.ALL"], Next: "Operation failed" }],
    Next: "Operation failed",
  };

  states["Operation complete"] = { Type: "Succeed" };
  states["Operation already satisfied"] = { Type: "Succeed" };
  states["Operation skipped"] = { Type: "Succeed" };
  states["Invalid operation"] = {
    Type: "Fail",
    Error: "InvalidSeasonalOperation",
    Cause: "operation must be WAKE, HIBERNATE, MAINTENANCE, or RECONCILE",
  };
  states["Invalid source"] = {
    Type: "Fail",
    Error: "InvalidSeasonalSource",
    Cause: "source must be schedule or operator",
  };
  states["Operation failed"] = {
    Type: "Fail",
    Error: "SeasonalOperationFailed",
    Cause: "The controller entered its safe failure state; inspect execution history.",
  };

  return {
    Comment: "BYC seasonal application and database controller",
    StartAt: "Get seasonal mode",
    TimeoutSeconds: 32400,
    States: states,
  };
}

export class SeasonalOperations extends cdk.Resource {
  public readonly stateMachineArn: string;
  public readonly stateParameterName: string;
  public readonly alertTopicArn: string;
  public readonly deadLetterQueueUrl: string;
  public readonly scheduleNames: Record<string, string>;

  constructor(scope: Construct, id: string, props: SeasonalOperationsProps) {
    super(scope, id);

    const wake = parseMonthDay(props.schedule.wakeMonthDay, "seasonWakeMonthDay");
    const hibernate = parseMonthDay(
      props.schedule.hibernateMonthDay,
      "seasonHibernateMonthDay",
    );
    const transition = parseTime(props.schedule.transitionTime);
    if (props.schedule.wakeMonthDay === props.schedule.hibernateMonthDay) {
      throw new Error("Season wake and hibernate dates must be different");
    }
    validateTimeZone(props.schedule.timeZone);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(props.schedule.alertEmail)) {
      throw new Error("opsAlertEmail must be a valid email address");
    }

    const stateParameter = new ssm.StringParameter(this, "SeasonalMode", {
      parameterName: `/byc/${cdk.Stack.of(this).stackName}/seasonal-mode`,
      description: "Authoritative BYC seasonal controller mode",
      stringValue: "ACTIVE",
      tier: ssm.ParameterTier.STANDARD,
    });

    const alertKey = new kms.Key(this, "SeasonalAlertsKey", {
      alias: `alias/${cdk.Stack.of(this).stackName.toLowerCase()}-seasonal-alerts`,
      description: "Encrypts BYC seasonal operations alerts",
      enableKeyRotation: true,
    });
    for (const service of [
      "events.amazonaws.com",
      "cloudwatch.amazonaws.com",
      "events.rds.amazonaws.com",
    ]) {
      alertKey.grantEncryptDecrypt(new iam.ServicePrincipal(service));
    }
    const alertTopic = new sns.Topic(this, "SeasonalAlerts", {
      displayName: "BYC seasonal operations alerts",
      masterKey: alertKey,
    });
    alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("events.rds.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [alertTopic.topicArn],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": cdk.Stack.of(this).account,
          },
        },
      }),
    );
    alertTopic.addSubscription(
      new subscriptions.EmailSubscription(props.schedule.alertEmail),
    );

    const deadLetterQueue = new sqs.Queue(this, "SeasonalScheduleDlq", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    const controllerLogGroup = new logs.LogGroup(this, "SeasonalControllerLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const stateMachineRole = new iam.Role(this, "SeasonalControllerRole", {
      assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
      description: "Least-privilege role for BYC seasonal ECS/RDS operations",
    });
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: [stateParameter.parameterArn],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:UpdateService"],
        resources: [props.service.serviceArn],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeServices"],
        resources: ["*"],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["rds:StartDBInstance", "rds:StopDBInstance"],
        resources: [props.database.instanceArn],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["rds:DescribeDBInstances"],
        resources: ["*"],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["elasticloadbalancing:ModifyRule"],
        resources: [props.activeSeasonRule.listenerRuleArn],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["elasticloadbalancing:DescribeTargetHealth"],
        resources: ["*"],
      }),
    );
    stateMachineRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      }),
    );

    const stateMachine = new stepfunctions.CfnStateMachine(this, "SeasonalController", {
      roleArn: stateMachineRole.roleArn,
      stateMachineType: "STANDARD",
      definitionString: JSON.stringify(buildStateMachineDefinition()),
      definitionSubstitutions: {
        StateParameterName: stateParameter.parameterName,
        DatabaseIdentifier: props.database.instanceIdentifier,
        ClusterArn: props.cluster.clusterArn,
        ServiceArn: props.service.serviceArn,
        TargetGroupArn: props.targetGroup.targetGroupArn,
        ActiveRuleArn: props.activeSeasonRule.listenerRuleArn,
      },
      loggingConfiguration: {
        destinations: [
          {
            cloudWatchLogsLogGroup: {
              logGroupArn: controllerLogGroup.logGroupArn,
            },
          },
        ],
        includeExecutionData: false,
        level: "ERROR",
      },
    });
    stateMachine.node.addDependency(stateMachineRole);

    const schedulerRole = new iam.Role(this, "SeasonalSchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Starts the BYC seasonal controller from EventBridge Scheduler",
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [stateMachine.attrArn],
      }),
    );
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sqs:SendMessage"],
        resources: [deadLetterQueue.queueArn],
      }),
    );

    const createSchedule = (
      constructId: string,
      nameSuffix: string,
      expression: string,
      timeZone: string,
      operation: string,
    ): scheduler.CfnSchedule => {
      const schedule = new scheduler.CfnSchedule(this, constructId, {
        name: `${cdk.Stack.of(this).stackName}-${nameSuffix}`,
        description: `BYC seasonal operation: ${operation}`,
        scheduleExpression: expression,
        scheduleExpressionTimezone: timeZone,
        flexibleTimeWindow: { mode: "OFF" },
        state: "ENABLED",
        target: {
          arn: stateMachine.attrArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({ operation, source: "schedule" }),
          deadLetterConfig: { arn: deadLetterQueue.queueArn },
          retryPolicy: {
            maximumEventAgeInSeconds: 3600,
            maximumRetryAttempts: 3,
          },
        },
      });
      schedule.node.addDependency(stateMachine, schedulerRole);
      return schedule;
    };

    const wakeSchedule = createSchedule(
      "WakeSchedule",
      "season-wake",
      `cron(${transition.minute} ${transition.hour} ${wake.day} ${wake.month} ? *)`,
      props.schedule.timeZone,
      "WAKE",
    );
    const hibernateSchedule = createSchedule(
      "HibernateSchedule",
      "season-hibernate",
      `cron(${transition.minute} ${transition.hour} ${hibernate.day} ${hibernate.month} ? *)`,
      props.schedule.timeZone,
      "HIBERNATE",
    );
    const maintenanceSchedule = createSchedule(
      "MaintenanceSchedule",
      "offseason-maintenance",
      "cron(0 4 ? * SUN *)",
      "UTC",
      "MAINTENANCE",
    );
    const reconcileSchedule = createSchedule(
      "ReconcileSchedule",
      "season-reconcile",
      "cron(0 10 * * ? *)",
      "UTC",
      "RECONCILE",
    );

    const failedExecutionRule = new events.Rule(this, "FailedExecutionRule", {
      description: "Notify operators when the BYC seasonal controller fails",
      eventPattern: {
        source: ["aws.states"],
        detailType: ["Step Functions Execution Status Change"],
        detail: {
          stateMachineArn: [stateMachine.attrArn],
          status: ["FAILED", "TIMED_OUT", "ABORTED"],
        },
      },
    });
    failedExecutionRule.addTarget(new eventTargets.SnsTopic(alertTopic));

    const failedExecutionMetric = new cloudwatch.Metric({
      namespace: "AWS/States",
      metricName: "ExecutionsFailed",
      dimensionsMap: { StateMachineArn: stateMachine.attrArn },
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });
    const failedExecutionAlarm = new cloudwatch.Alarm(this, "FailedExecutionAlarm", {
      metric: failedExecutionMetric,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "The BYC seasonal controller reported a failed execution",
    });
    failedExecutionAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const timedOutExecutionMetric = new cloudwatch.Metric({
      namespace: "AWS/States",
      metricName: "ExecutionsTimedOut",
      dimensionsMap: { StateMachineArn: stateMachine.attrArn },
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });
    const timedOutExecutionAlarm = new cloudwatch.Alarm(this, "TimedOutExecutionAlarm", {
      metric: timedOutExecutionMetric,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "The BYC seasonal controller timed out",
    });
    timedOutExecutionAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const dlqAlarm = new cloudwatch.Alarm(this, "SeasonalScheduleDlqAlarm", {
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "An EventBridge Scheduler invocation reached the seasonal DLQ",
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const databaseOperationsEvents = new rds.CfnEventSubscription(
      this,
      "DatabaseOperationsEvents",
      {
        snsTopicArn: alertTopic.topicArn,
        sourceType: "db-instance",
        sourceIds: [props.database.instanceIdentifier],
        eventCategories: ["backup", "failure", "maintenance", "recovery", "restoration"],
        enabled: true,
      },
    );
    const alertTopicPolicy = alertTopic.node.tryFindChild("Policy");
    if (alertTopicPolicy) {
      databaseOperationsEvents.node.addDependency(alertTopicPolicy);
    }

    this.stateMachineArn = stateMachine.attrArn;
    this.stateParameterName = stateParameter.parameterName;
    this.alertTopicArn = alertTopic.topicArn;
    this.deadLetterQueueUrl = deadLetterQueue.queueUrl;
    this.scheduleNames = {
      wake: wakeSchedule.ref,
      hibernate: hibernateSchedule.ref,
      maintenance: maintenanceSchedule.ref,
      reconcile: reconcileSchedule.ref,
    };
  }
}
