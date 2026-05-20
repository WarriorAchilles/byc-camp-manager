#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BycCampDevStack } from "../lib/byc-camp-dev-stack";

const app = new cdk.App();

const account =
  app.node.tryGetContext("account") ?? process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID;
const region =
  app.node.tryGetContext("region") ?? process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1";

new BycCampDevStack(app, "BycCampDevStack", {
  env: account && region ? { account: String(account), region: String(region) } : undefined,
  description: "BYC Camp Manager — dev/staging (ECS Fargate + ALB + RDS)",
});

app.synth();
