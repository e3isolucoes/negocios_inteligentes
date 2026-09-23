import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { GetCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

function metric(name, value = 1) {
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'E3I/Deletion', Dimensions: [['Environment']], Metrics: [{ Name: name, Unit: 'Count' }] }] }, Environment: process.env.APP_ENV || 'unknown', [name]: value }));
}

export async function processDeletion({ ddb, s3, tableName, bucket }, event) {
  event = Object.fromEntries(Object.entries(event).map(([key, value]) => [key, value?.S ?? (value?.N === undefined ? value : Number(value.N))]));
  const key = { PK: event.PK, SK: event.entity_sk };
  const current = (await ddb.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }))).Item;
  if (!current || current.deletion_event_id !== event.id) return { duplicate: true };
  // DeleteObject succeeds when the key is already absent, making retries safe.
  if (event.attachment_path) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: event.attachment_path }));
  const uniqueDelete = event.entity === 'completions'
    ? [{ Delete: { TableName: tableName, Key: { PK: event.PK, SK: `UNIQUE#COMPLETION#${event.obligation_id}#${event.occurrence_date}` } } }]
    : [];
  const completedAt = new Date().toISOString();
  await ddb.send(new TransactWriteCommand({ TransactItems: [
    { Delete: { TableName: tableName, Key: key, ConditionExpression: 'deletion_event_id = :eventId', ExpressionAttributeValues: { ':eventId': event.id } } },
    ...uniqueDelete,
    { Delete: { TableName: tableName, Key: { PK: event.PK, SK: `OUTBOX#DELETE#${event.id}` } } },
    { Put: { TableName: tableName, Item: { PK: event.PK, SK: `AUDIT#${completedAt}#${randomUUID()}`, entityType: 'audit_log', action: 'DELETE_COMPLETED', table_name: event.entity, record_id: event.entity_id, created_at: completedAt } } }
  ] }));
  metric('DeletionCompleted');
  return { deleted: true };
}

export function deletionHandler(dependencies) {
  return async event => {
    const failures = [];
    for (const record of event.Records || []) {
      try { await processDeletion(dependencies, JSON.parse(record.body)); }
      catch (error) {
        metric('DeletionAttemptFailed');
        console.error(JSON.stringify({ level: 'error', operation: 'delete', message: error.message }));
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

export async function reconcileDeletions({ ddb, s3, tableName, bucket }) {
  const references = new Set(); const knownObjects = new Set(); const outboxes = []; let startKey;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }));
    for (const item of page.Items || []) {
      if (item.attachment_path) knownObjects.add(item.attachment_path);
      if (item.attachment_path && !item.deletion_pending) references.add(item.attachment_path);
      if (item.entityType === 'file_deletion_outbox') outboxes.push(item);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  let reconciliationFailures = 0;
  for (const outbox of outboxes) {
    try { await processDeletion({ ddb, s3, tableName, bucket }, outbox); }
    catch (error) { reconciliationFailures += 1; console.error(JSON.stringify({ level: 'error', operation: 'reconcile_delete', eventId: outbox.id, message: error.message })); }
  }
  const objects = new Set(); let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const object of page.Contents || []) objects.add(object.Key);
    token = page.NextContinuationToken;
  } while (token);
  const orphaned = [...objects].filter(key => !knownObjects.has(key));
  const missing = [...references].filter(key => !objects.has(key));
  metric('PendingDeletion', outboxes.length); metric('ReconciliationFailure', reconciliationFailures); metric('OrphanedObject', orphaned.length); metric('MissingReferencedObject', missing.length);
  console.log(JSON.stringify({ operation: 'deletion_reconciliation', pending: outboxes.length, reconciliationFailures, orphaned, missing }));
  return { pending: outboxes.length, reconciliationFailures, orphaned, missing };
}
