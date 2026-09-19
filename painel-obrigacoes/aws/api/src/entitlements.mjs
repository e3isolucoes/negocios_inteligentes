import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({}),
  { marshallOptions: { removeUndefinedValues: true } },
);

export async function suspendExpiredEntitlements(
  client,
  tableName,
  now = new Date(),
) {
  const nowIso = new Date(now).toISOString();
  let exclusiveStartKey;
  let scanned = 0;
  let suspended = 0;

  do {
    const page = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(SK, :prefix) AND #status = :active AND renewsAt <= :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':prefix': 'ENTITLEMENT#',
        ':active': 'ativo',
        ':now': nowIso,
      },
      ProjectionExpression: 'PK, SK, #status, renewsAt',
      ExclusiveStartKey: exclusiveStartKey,
    }));

    const items = page.Items || [];
    scanned += items.length;

    for (const item of items) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET #status = :suspended, suspendedAt = :now, updatedAt = :now',
          ConditionExpression: '#status = :active AND renewsAt <= :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':active': 'ativo',
            ':suspended': 'suspenso',
            ':now': nowIso,
          },
        }));
        suspended += 1;
      } catch (error) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
      }
    }

    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return { scanned, suspended, evaluatedAt: nowIso };
}

export async function handler() {
  return suspendExpiredEntitlements(
    ddb,
    process.env.TABLE_NAME,
    new Date(),
  );
}
