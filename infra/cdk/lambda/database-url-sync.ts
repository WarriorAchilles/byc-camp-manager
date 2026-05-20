import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { CloudFormationCustomResourceEvent } from "aws-lambda";

const sm = new SecretsManagerClient({});

type Props = {
  RdsSecretArn: string;
  TargetSecretArn: string;
};

/**
 * CloudFormation custom resource (via aws-cdk-lib Provider) — builds Prisma
 * DATABASE_URL from the RDS master secret JSON and writes it to TargetSecretArn.
 */
export async function handler(
  event: CloudFormationCustomResourceEvent,
  _context: unknown,
): Promise<{ PhysicalResourceId: string; Data: Record<string, string> }> {
  const props = event.ResourceProperties as unknown as Props;
  const physicalResourceId = props.TargetSecretArn;

  if (event.RequestType === "Delete") {
    return { PhysicalResourceId: event.PhysicalResourceId || physicalResourceId, Data: {} };
  }

  const raw = await sm.send(new GetSecretValueCommand({ SecretId: props.RdsSecretArn }));
  if (!raw.SecretString) {
    throw new Error("RDS secret has no SecretString");
  }
  const data = JSON.parse(raw.SecretString) as {
    username: string;
    password: string;
    host: string;
    port: number;
    dbname: string;
  };
  const databaseUrl = `postgresql://${encodeURIComponent(data.username)}:${encodeURIComponent(data.password)}@${data.host}:${data.port}/${data.dbname}?schema=public&sslmode=require`;
  await sm.send(
    new PutSecretValueCommand({
      SecretId: props.TargetSecretArn,
      SecretString: databaseUrl,
    }),
  );

  return {
    PhysicalResourceId: physicalResourceId,
    Data: { SecretArn: props.TargetSecretArn },
  };
}
