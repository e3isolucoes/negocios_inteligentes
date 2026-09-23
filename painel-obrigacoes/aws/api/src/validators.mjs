import { CANONICAL_COMPLETION_STATUSES, CANONICAL_ROLES, canonicalCompletionStatus, canonicalRole } from './contract.mjs';

const IDENTIFIER = /^[a-zA-Z0-9_.:@+-]{1,200}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const text = (max, options = {}) => ({ type: 'string', max, ...options });
const id = (options = {}) => text(200, { format: 'identifier', ...options });
const date = (options = {}) => text(10, { format: 'date', ...options });
const timestamp = (options = {}) => text(40, { format: 'timestamp', ...options });
const integer = (min, max, options = {}) => ({ type: 'integer', min, max, ...options });
const boolean = (options = {}) => ({ type: 'boolean', ...options });
const enumeration = (values, options = {}) => text(Math.max(...values.map(value => value.length)), { enum: values, ...options });
const ids = (options = {}) => ({ type: 'array', max: 31, item: integer(1, 12), ...options });
const strings = (options = {}) => ({ type: 'array', max: 100, item: text(500), ...options });

const schemas = Object.freeze({
  profiles: {
    fields: { id: id(), email: text(254, { format: 'email' }), display_name: text(160), role: enumeration(CANONICAL_ROLES, { adapter: canonicalRole }), active: boolean(), module_access: strings() },
    required: ['email', 'display_name', 'role']
  },
  companies: {
    fields: { id: id(), name: text(200), tax_regime_id: id({ nullable: true }) }, required: ['name']
  },
  obligations: {
    fields: {
      id: id(), name: text(300), category: text(100), company_id: id({ nullable: true }), responsible: text(200), responsible_id: id({ nullable: true }),
      frequency: enumeration(['diaria', 'mensal', 'trimestral', 'anual', 'pontual']), day_of_month: integer(1, 31, { nullable: true }), month: integer(1, 12, { nullable: true }), months: ids({ nullable: true }),
      due_date: date({ nullable: true }), competence_offset_months: integer(0, 36), notes: text(10_000), activity_type: enumeration(['obrigacao_acessoria', 'rotina', 'tarefa', 'marco']), process_name: text(300), area_name: text(200),
      predecessor_id: id({ nullable: true }), module_key: id(), requires_attachment: boolean(), requires_attachment_no_movement: boolean(), priority: enumeration(['baixa', 'media', 'alta', 'critica']),
      adjust_business_day: boolean(), day_type: enumeration(['fixo', 'util_do_mes']), business_day_shift: enumeration(['nenhum', 'proximo_util', 'anterior_util']), requires_validation: boolean(), validator_id: id({ nullable: true })
    },
    required: ['name', 'category', 'frequency']
  },
  completions: {
    fields: {
      id: id(), obligation_id: id(), occurrence_date: date(), done_by: id({ nullable: true }), done_by_name: text(200), done_at: timestamp(), movement_status: enumeration(['nao_informado', 'com_movimento', 'sem_movimento']),
      attachment_path: text(1024, { nullable: true }), checklist_total: integer(0, 10_000, { nullable: true }), checklist_checked: integer(0, 10_000, { nullable: true }),
      ocr_status: enumeration(['ok', 'mismatch', 'not_checked'], { nullable: true }), ocr_extracted_period: text(40, { nullable: true }), status: enumeration(CANONICAL_COMPLETION_STATUSES, { adapter: canonicalCompletionStatus }),
      validator_id: id({ nullable: true }), submitted_at: timestamp(), validated_at: timestamp({ nullable: true }), rejected_at: timestamp({ nullable: true }), validated_by: id({ nullable: true }), rejection_reason: text(2_000, { nullable: true })
    }, required: ['obligation_id', 'occurrence_date', 'done_by_name']
  },
  obligation_comments: { fields: { id: id(), obligation_id: id(), author_id: id({ nullable: true }), author_name: text(200), body: text(10_000) }, required: ['obligation_id', 'author_name', 'body'] },
  holidays: { fields: { id: id(), holiday_date: date(), name: text(200), scope: enumeration(['nacional', 'estadual', 'municipal']) }, required: ['holiday_date', 'name'] },
  checklist_items: { fields: { id: id(), obligation_id: id(), description: text(1_000), position: integer(0, 10_000), done: boolean(), completed: boolean(), completed_by: id({ nullable: true }), completed_at: timestamp({ nullable: true }) }, required: ['obligation_id', 'description'] },
  obligation_rules: {
    fields: { id: id(), name: text(300), category: text(100), frequency: enumeration(['mensal', 'trimestral', 'anual']), day_type: enumeration(['fixo', 'util_do_mes']), day_of_month: integer(1, 31), month: integer(1, 12, { nullable: true }), months: ids({ nullable: true }), competence_offset_months: integer(0, 36), adjust_business_day: boolean(), business_day_shift: enumeration(['nenhum', 'proximo_util', 'anterior_util']), notes: text(10_000), checklist_template: strings() },
    required: ['name', 'category', 'frequency', 'day_of_month']
  },
  obligation_date_overrides: { fields: { id: id(), obligation_id: id(), original_date: date(), override_date: date(), reason: text(2_000) }, required: ['obligation_id', 'original_date', 'override_date'] },
  tax_regimes: { fields: { id: id(), name: text(200), description: text(5_000) }, required: ['name'] },
  tax_regime_rules: { fields: { id: id(), tax_regime_id: id(), obligation_rule_id: id() }, required: ['tax_regime_id', 'obligation_rule_id'] },
  categories: { fields: { id: id(), name: text(100), descricao: text(2_000, { nullable: true }), cor: text(7, { format: 'color' }), ordem: integer(0, 100_000), ativo: boolean(), sistema: boolean(), exige_validacao: boolean(), validador_padrao_id: id({ nullable: true }) }, required: ['name'] },
  workspaces: { fields: { id: id(), name: text(200), document: text(14, { nullable: true }), access_status: enumeration(['trial', 'full', 'suspended']), trial_ends_at: date({ nullable: true }) }, required: ['name'] }
});

export function validateCreate(entity, input) { return validate(entity, input, true); }
export function validateUpdate(entity, input) { return validate(entity, input, false); }

function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }

function validate(entity, input, creating) {
  const schema = schemas[entity];
  if (!schema) invalid('Entidade não possui validador de escrita.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Payload deve ser um objeto.');
  const keys = Object.keys(input);
  if (keys.length > 50) invalid('Payload possui campos demais.');
  for (const key of keys) if (!(key in schema.fields) && !(key === 'version' && !creating)) invalid(`Campo não permitido: ${key}.`);
  if (creating) for (const field of schema.required) if (input[field] === undefined || input[field] === null || input[field] === '') invalid(`Campo obrigatório: ${field}.`);
  if (!creating && keys.length === 0) invalid('Payload de atualização vazio.');

  const output = {};
  for (const key of keys) {
    if (key === 'version') {
      if (!Number.isInteger(input[key]) || input[key] < 1) invalid('Campo inválido: version.');
      output[key] = input[key]; continue;
    }
    output[key] = validateValue(key, input[key], schema.fields[key]);
  }
  validateEntity(entity, { ...input, ...output }, creating);
  return Object.freeze(output);
}

function validateValue(name, value, rule) {
  if (value === null && rule.nullable) return null;
  if (rule.type === 'string') {
    if (typeof value !== 'string') invalid(`Campo inválido: ${name}.`);
    const normalized = value.trim();
    const adapted = rule.adapter ? rule.adapter(normalized) : normalized;
    if (rule.enum && !rule.enum.includes(adapted)) invalid(`Valor não permitido: ${name}.`);
    if (normalized.length > rule.max) invalid(`Campo excede o tamanho máximo: ${name}.`);
    if (rule.format === 'identifier' && !IDENTIFIER.test(normalized)) invalid(`Identificador inválido: ${name}.`);
    if (rule.format === 'date' && !validDate(normalized)) invalid(`Data inválida: ${name}.`);
    if (rule.format === 'timestamp' && (!TIMESTAMP.test(normalized) || Number.isNaN(Date.parse(normalized)))) invalid(`Data e hora inválida: ${name}.`);
    if (rule.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) invalid(`Formato inválido: ${name}.`);
    if (rule.format === 'color' && !/^#[0-9a-fA-F]{6}$/.test(normalized)) invalid(`Formato inválido: ${name}.`);
    return adapted;
  }
  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') invalid(`Campo inválido: ${name}.`);
    return value;
  }
  if (rule.type === 'integer') {
    if (!Number.isInteger(value) || value < rule.min || value > rule.max) invalid(`Campo inválido: ${name}.`);
    return value;
  }
  if (!Array.isArray(value) || value.length > rule.max) invalid(`Campo inválido: ${name}.`);
  return value.map((item, index) => validateValue(`${name}[${index}]`, item, rule.item));
}

function validDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const dateValue = new Date(`${value}T00:00:00.000Z`);
  return dateValue.getUTCFullYear() === Number(match[1]) && dateValue.getUTCMonth() + 1 === Number(match[2]) && dateValue.getUTCDate() === Number(match[3]);
}

function validateEntity(entity, value, creating) {
  if (entity === 'obligations' || entity === 'obligation_rules') {
    if (value.frequency === 'mensal' && value.day_of_month == null) invalid('Campo obrigatório para a frequência: day_of_month.');
    if (value.frequency === 'trimestral' && (value.day_of_month == null || !value.months?.length)) invalid('Campos obrigatórios para a frequência trimestral.');
    if (value.frequency === 'anual' && (value.day_of_month == null || value.month == null)) invalid('Campos obrigatórios para a frequência anual.');
    if (entity === 'obligations' && value.frequency === 'pontual' && !value.due_date) invalid('Campo obrigatório para a frequência pontual: due_date.');
  }
  if (entity === 'completions' && value.checklist_total != null && value.checklist_checked != null && value.checklist_checked > value.checklist_total) invalid('Checklist inválido.');
  if (entity === 'completions' && value.status === 'rejeitada' && !value.rejection_reason?.trim()) invalid('Motivo obrigatório para uma rejeição.');
  if (entity === 'workspaces' && value.access_status === 'trial' && !value.trial_ends_at) invalid('Campo obrigatório para acesso trial: trial_ends_at.');
}

export const entityRelationships = Object.freeze({
  companies: { tax_regime_id: 'tax_regimes' },
  obligations: { company_id: 'companies', responsible_id: 'profiles', predecessor_id: 'obligations', validator_id: 'profiles' },
  completions: { obligation_id: 'obligations', done_by: 'profiles', validator_id: 'profiles', validated_by: 'profiles' },
  obligation_comments: { obligation_id: 'obligations', author_id: 'profiles' },
  checklist_items: { obligation_id: 'obligations', completed_by: 'profiles' },
  obligation_date_overrides: { obligation_id: 'obligations' },
  tax_regime_rules: { tax_regime_id: 'tax_regimes', obligation_rule_id: 'obligation_rules' },
  categories: { validador_padrao_id: 'profiles' }
});
