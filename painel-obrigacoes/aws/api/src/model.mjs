export const TOOL_ID = process.env.TOOL_ID || 'painel-obrigacoes';
export const APP_ENV = process.env.APP_ENV || 'dev';
export const SCHEMA_VERSION = 1;

const ENTITY_CONFIG = Object.freeze({
  profiles: { prefix: 'PROFILE', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['admin', 'super_admin'] },
  companies: { prefix: 'COMPANY', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['manager', 'admin', 'super_admin'] },
  obligations: { prefix: 'OBLIGATION', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['member', 'manager', 'admin', 'super_admin'] },
  completions: { prefix: 'COMPLETION', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['member', 'manager', 'admin', 'super_admin'] },
  obligation_comments: { prefix: 'COMMENT', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['member', 'manager', 'admin', 'super_admin'] },
  audit_log: { prefix: 'AUDIT', grant: 'administracao', read: ['admin', 'super_admin'], write: [] },
  holidays: { prefix: 'HOLIDAY', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['manager', 'admin', 'super_admin'] },
  checklist_items: { prefix: 'CHECKLIST', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['member', 'manager', 'admin', 'super_admin'] },
  obligation_rules: { prefix: 'RULE', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['manager', 'admin', 'super_admin'] },
  obligation_date_overrides: { prefix: 'DATE_OVERRIDE', grant: 'obrigacoes', read: ['member', 'manager', 'admin', 'super_admin'], write: ['manager', 'admin', 'super_admin'] },
  tax_regimes: { prefix: 'TAX_REGIME', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['admin', 'super_admin'] },
  tax_regime_rules: { prefix: 'TAX_REGIME_RULE', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['admin', 'super_admin'] },
  categories: { prefix: 'CATEGORY', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['manager', 'admin', 'super_admin'] },
  workspaces: { prefix: 'WORKSPACE_META', grant: 'administracao', read: ['member', 'manager', 'admin', 'super_admin'], write: ['super_admin'] }
});

export function entityConfig(entity) {
  const config = ENTITY_CONFIG[entity];
  if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });
  return config;
}

export function tenantPk(workspaceId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId || '')) throw Object.assign(new Error('Empresa inválida.'), { statusCode: 400 });
  return `TOOL#${TOOL_ID}#ENV#${APP_ENV}#WORKSPACE#${workspaceId}`;
}

export function membershipPk(userId) {
  return `TOOL#${TOOL_ID}#ENV#${APP_ENV}#USER#${userId}`;
}

export function entitySk(entity, id, record = {}) {
  const prefix = entityConfig(entity).prefix;
  if (!id || !/^[a-zA-Z0-9_.:@+-]{1,200}$/.test(String(id))) throw Object.assign(new Error('Identificador inválido.'), { statusCode: 400 });
  return `${prefix}#${id}`;
}

export function publicRecord(item) {
  if (!item) return null;
  const { PK, SK, GSI1PK, GSI1SK, ...record } = item;
  return record;
}

export const allowedEntities = Object.freeze(Object.keys(ENTITY_CONFIG));
