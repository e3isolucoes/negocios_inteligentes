import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient, enrichRows, entities, fetchAll, requiredEnv, tenantPk, toItem } from './shared.mjs';

const config = requiredEnv();
const client = await documentClient();
const fetched = {};
for (const entity of Object.keys(entities)) fetched[entity] = await fetchAll(config, entity);
const rows = enrichRows(fetched);
const report = { checkedAt: new Date().toISOString(), workspaces: {}, sourceMissing: 0 };

for (const workspace of rows.workspaces) {
  const workspaceReport = {};
  for (const [entity, prefix] of Object.entries(entities)) {
    const sourceKeys = new Set(rows[entity]
      .filter((row) => (row.workspace_id || row.id) === workspace.id)
      .map((row) => toItem(config, entity, row).SK));
    const targetKeys = new Set();
    let ExclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: config.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': tenantPk(config, workspace.id), ':sk': `${prefix}#` },
        ProjectionExpression: 'SK',
        ExclusiveStartKey
      }));
      for (const item of result.Items || []) targetKeys.add(item.SK);
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const missing = [...sourceKeys].filter((key) => !targetKeys.has(key));
    const extras = [...targetKeys].filter((key) => !sourceKeys.has(key));
    report.sourceMissing += missing.length;
    workspaceReport[entity] = {
      source: sourceKeys.size,
      target: targetKeys.size,
      sourceMissing: missing.length,
      targetExtras: extras.length
    };
  }
  report.workspaces[workspace.id] = workspaceReport;
}

report.sourceCovered = report.sourceMissing === 0;
console.log(JSON.stringify(report, null, 2));
if (!report.sourceCovered) process.exitCode = 2;
