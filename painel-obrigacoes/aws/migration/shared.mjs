export const entities = Object.freeze({
  workspaces: 'WORKSPACE_META', profiles: 'PROFILE', companies: 'COMPANY', obligations: 'OBLIGATION',
  completions: 'COMPLETION', obligation_comments: 'COMMENT', audit_log: 'AUDIT', holidays: 'HOLIDAY',
  checklist_items: 'CHECKLIST', obligation_rules: 'RULE', obligation_date_overrides: 'DATE_OVERRIDE',
  tax_regimes: 'TAX_REGIME', tax_regime_rules: 'TAX_REGIME_RULE', categories: 'CATEGORY'
});

export function requiredEnv() {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DYNAMODB_TABLE'];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Variáveis ausentes: ${missing.join(', ')}`);
  return {
    supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ''), serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    table: process.env.DYNAMODB_TABLE, toolId: process.env.TOOL_ID || 'painel-obrigacoes', appEnv: process.env.APP_ENV || 'prod'
  };
}

export async function fetchAll(config, table) {
  const rows = []; const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=*`, { headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`, range: `${from}-${from + pageSize - 1}`, prefer: 'count=exact' } });
    if (!response.ok) throw new Error(`${table}: Supabase respondeu HTTP ${response.status}`);
    const page = await response.json(); rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function tenantPk(config, workspaceId) { return `TOOL#${config.toolId}#ENV#${config.appEnv}#WORKSPACE#${workspaceId}`; }
export function membershipPk(config, userId) { return `TOOL#${config.toolId}#ENV#${config.appEnv}#USER#${userId}`; }
export function administrationPk(config) { return `TOOL#${config.toolId}#ENV#${config.appEnv}#ADMINISTRATION`; }

export function normalizeRole(role) {
  return ({ membro: 'member', gestor: 'manager', administrador: 'admin' })[role] || role || 'member';
}

export function toItem(config, entity, row) {
  const workspaceId = entity === 'workspaces' ? row.id : row.workspace_id;
  if (entity === 'profiles' && !workspaceId && row.role === 'super_admin') {
    return {
      ...row,
      PK: administrationPk(config),
      SK: `PROFILE#${row.id}`,
      toolId: config.toolId,
      environment: config.appEnv,
      entityType: entity,
      scope: 'administration',
      schemaVersion: 1,
      migratedAt: new Date().toISOString()
    };
  }
  if (!workspaceId) throw new Error(`${entity}/${row.id}: workspace_id ausente`);
  const prefix = entities[entity];
  const id = row.id || (entity === 'tax_regime_rules' ? `${row.tax_regime_id}:${row.obligation_rule_id}` : null);
  if (!id) throw new Error(`${entity}: identificador ausente`);
  const migrated = { ...row };
  if (entity === 'completions' && row.attachment_path) migrated.attachment_path = `${config.toolId}/${config.appEnv}/${workspaceId}/legacy/${String(row.attachment_path).replace(/^\/+/, '')}`;
  return { ...migrated, PK: tenantPk(config, workspaceId), SK: `${prefix}#${id}`, toolId: config.toolId, environment: config.appEnv, workspace_id: workspaceId, entityType: entity, schemaVersion: 1, migratedAt: new Date().toISOString() };
}

export function membershipItem(config, profile) {
  return { PK: membershipPk(config, profile.id), SK: `MEMBERSHIP#${profile.workspace_id}`, userId: profile.id, workspaceId: profile.workspace_id, role: normalizeRole(profile.role), active: profile.active !== false, email: profile.email, toolId: config.toolId, environment: config.appEnv, entityType: 'membership', schemaVersion: 1 };
}

export function enrichRows(allRows) {
  const regimeWorkspace = new Map((allRows.tax_regimes || []).map((row) => [row.id, row.workspace_id]));
  const ruleWorkspace = new Map((allRows.obligation_rules || []).map((row) => [row.id, row.workspace_id]));
  return {
    ...allRows,
    tax_regime_rules: (allRows.tax_regime_rules || []).map((row) => ({
      ...row,
      workspace_id: row.workspace_id || regimeWorkspace.get(row.tax_regime_id) || ruleWorkspace.get(row.obligation_rule_id)
    }))
  };
}

export async function documentClient() {
  const [{ DynamoDBClient }, { DynamoDBDocumentClient }] = await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb')]);
  return DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true } });
}

export async function countPrefix(client, table, pk, prefix) {
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  let count = 0; let ExclusiveStartKey;
  do {
    const result = await client.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', ExpressionAttributeValues: { ':pk': pk, ':sk': `${prefix}#` }, Select: 'COUNT', ExclusiveStartKey }));
    count += result.Count || 0; ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
}
