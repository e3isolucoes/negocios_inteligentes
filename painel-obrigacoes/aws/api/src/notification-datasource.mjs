const TYPES = new Set(['obligations', 'completions', 'holidays', 'profiles', 'obligation_date_overrides']);

export function emptyDataset() {
  return { obligations: [], completions: [], holidays: [], profiles: [], overrides: [] };
}

export function normalizeSupabaseFixture(fixture) {
  return {
    obligations: fixture.obligations || [], completions: fixture.completions || [],
    holidays: fixture.holidays || [], profiles: fixture.profiles || [],
    overrides: fixture.obligation_date_overrides || fixture.overrides || []
  };
}

export function normalizeDynamoItems(items, workspaceId) {
  const data = emptyDataset();
  for (const item of items) {
    if (!TYPES.has(item.entityType) || item.workspace_id !== workspaceId || item.deletion_pending) continue;
    const key = item.entityType === 'obligation_date_overrides' ? 'overrides' : item.entityType;
    const { PK, SK, GSI1PK, GSI1SK, ...record } = item;
    // alertas-core is also used by the rollback datasource and deliberately
    // retains the legacy Supabase role vocabulary. Adapt the AWS contract at
    // the datasource boundary instead of forking its recipient rules.
    if (key === 'profiles' && record.role === 'manager') record.role = 'gestor';
    if (key === 'profiles' && record.role === 'member') record.role = 'membro';
    data[key].push(record);
  }
  return data;
}

export function mismatchesForProfile(items, profile) {
  if (profile.role === 'admin') return items;
  const modules = new Set(profile.module_access || []);
  return items.filter((item) => !item.obligation?.module_key || modules.has(item.obligation.module_key));
}

async function allPages(client, commandFor) {
  const items = []; let ExclusiveStartKey;
  do {
    const page = await client.send(commandFor(ExclusiveStartKey));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function loadDynamoWorkspaces(client, tableName, { QueryCommand }) {
  const toolId = process.env.TOOL_ID || 'painel-obrigacoes';
  const environment = process.env.APP_ENV || 'prod';
  // Discover tenants only through this deployment's administration partition.
  // This avoids a table-wide Scan and cannot discover another tool/environment.
  const metadata = await allPages(client, (ExclusiveStartKey) => new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :workspace)',
    ExpressionAttributeValues: {
      ':pk': `TOOL#${toolId}#ENV#${environment}#ADMINISTRATION`,
      ':workspace': 'WORKSPACE#'
    },
    ProjectionExpression: 'id, workspace_id',
    ExclusiveStartKey
  }));
  const ids = [...new Set(metadata.map((item) => item.workspace_id || item.id).filter(Boolean))];
  const result = [];
  for (const workspaceId of ids) {
    const prefix = `TOOL#${toolId}#ENV#${environment}#WORKSPACE#${workspaceId}`;
    const items = await allPages(client, (ExclusiveStartKey) => new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': prefix },
      ExclusiveStartKey
    }));
    result.push({ workspaceId, data: normalizeDynamoItems(items, workspaceId) });
  }
  return result;
}
