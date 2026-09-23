import { randomUUID } from 'node:crypto';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { entityConfig, entitySk, publicRecord, SCHEMA_VERSION, tenantPk, TOOL_ID, APP_ENV } from './model.mjs';
import { memberIndexKeys, memberSk, workspacePk } from './model-generic.mjs';
import { requireModuleGrant, requireRole } from './auth.mjs';
import { entityRelationships, validateCreate, validateUpdate } from './validators.mjs';
import { canonicalCompletionStatus } from './contract.mjs';

const now = () => new Date().toISOString();

function authRoleFromProfileRole(role) {
  return ({
    membro: 'member',
    gestor: 'manager',
    member: 'member',
    manager: 'manager',
    admin: 'admin',
    super_admin: 'super_admin',
  })[role] || 'member';
}

function memberSyncTransaction(tableName, workspaceId, profileId, profile, patch) {
  const index = memberIndexKeys(workspaceId, profileId);
  const setParts = [
    '#role = :role',
    'active = :active',
    'workspaceId = :workspaceId',
    'userId = :userId',
    'GSI1PK = :gsi1pk',
    'GSI1SK = :gsi1sk',
    'entityType = :memberEntity',
    'updated_at = :updatedAt',
  ];
  const values = {
    ':role': authRoleFromProfileRole(profile.role),
    ':active': profile.active !== false,
    ':workspaceId': workspaceId,
    ':userId': profileId,
    ':gsi1pk': index.GSI1PK,
    ':gsi1sk': index.GSI1SK,
    ':memberEntity': 'member',
    ':updatedAt': profile.updated_at || now(),
  };
  if (patch?.module_grants !== undefined) {
    setParts.push('module_grants = :moduleGrants');
    values[':moduleGrants'] = Array.isArray(profile.module_grants) ? profile.module_grants : [];
  }
  return {
    Update: {
      TableName: tableName,
      Key: { PK: workspacePk(workspaceId), SK: memberSk(profileId) },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    },
  };
}

export class Repository {
  constructor(client, tableName) { this.client = client; this.tableName = tableName; }

  requireSafeProfileUpdate(auth, current, patch) {
    if (!patch || typeof patch !== 'object') return;
    const toolAdmin = ['admin', 'super_admin'].includes(auth?.role);
    if (!toolAdmin) {
      const allowed = new Set(['module_access', 'display_name', 'version']);
      const forbidden = Object.keys(patch).filter((key) => !allowed.has(key));
      if (forbidden.length) throw Object.assign(new Error('A delegação administrativa não permite alterar papel, vínculo ou concessões de segurança.'), { statusCode: 403 });
    }
    if (Object.hasOwn(patch, 'role')) {
      if (!toolAdmin) throw Object.assign(new Error('Somente o Admin da Ferramenta pode alterar papéis de acesso.'), { statusCode: 403 });
      if ((patch.role === 'super_admin' || current?.role === 'super_admin') && auth.role !== 'super_admin') {
        throw Object.assign(new Error('Somente super_admin pode conceder ou alterar este papel.'), { statusCode: 403 });
      }
      if (current?.id === auth.userId && patch.role !== current.role) {
        throw Object.assign(new Error('Não é permitido alterar o próprio papel.'), { statusCode: 403 });
      }
    }
    if ((Object.hasOwn(patch, 'active') || Object.hasOwn(patch, 'module_grants')) && !toolAdmin) {
      throw Object.assign(new Error('Somente o Admin da Ferramenta pode alterar este controle de acesso.'), { statusCode: 403 });
    }
  }

  async list(auth, entity, { limit = 100, cursor } = {}) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.readGrant || config.grant);
    requireRole(auth, config.read);
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const exclusiveStartKey = cursor ? decodeCursor(cursor) : undefined;
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': tenantPk(auth.workspaceId), ':prefix': `${config.prefix}#` },
      Limit: safeLimit,
      ExclusiveStartKey: exclusiveStartKey
    }));
    return {
      items: (result.Items || []).filter(item => !item.deletion_pending).map(publicRecord),
      cursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null
    };
  }

  async get(auth, entity, id) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.readGrant || config.grant);
    requireRole(auth, config.read);
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id) } }));
    return result.Item?.deletion_pending ? null : publicRecord(result.Item);
  }

  async create(auth, entity, input) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.writeGrant || config.grant);
    requireRole(auth, config.create || config.write);
    const validated = validateCreate(entity, input);
    this.requireSafeProfileRoleChange(auth, null, validated, true);
    if (entity === 'completions' && validated.done_by && validated.done_by !== auth.userId) {
      throw Object.assign(new Error('Não é permitido concluir em nome de outro usuário.'), { statusCode: 403 });
    }
    if (entity === 'completions') this.rejectClientManagedCompletionMetadata(validated, true);
    await this.requireRelationships(auth, entity, validated);
    const id = validated.id || randomUUID();
    const timestamp = now();
    const entityDefaults = entity === 'completions'
      ? await this.completionCreateDefaults(auth, validated, timestamp)
      : {};
    const record = { ...validated, ...entityDefaults, id, version: 1, toolId: TOOL_ID, environment: APP_ENV, workspace_id: auth.workspaceId, entityType: entity, schemaVersion: SCHEMA_VERSION, created_at: timestamp, updated_at: timestamp };
    const item = { ...record, PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id, record) };
    const audit = this.auditItem(auth, 'INSERT', entity, id, null, record);
    const uniqueOccurrence = entity === 'completions'
      ? { Put: { TableName: this.tableName, Item: { PK: item.PK, SK: `UNIQUE#COMPLETION#${record.obligation_id}#${record.occurrence_date}`, entityType: 'uniqueness_lock', completionId: id }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } }
      : null;
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
        ...(uniqueOccurrence ? [uniqueOccurrence] : []),
        { Put: { TableName: this.tableName, Item: audit } }
      ] }));
    } catch (error) {
      if (error.name === 'TransactionCanceledException') throw Object.assign(new Error('Registro já existente ou concorrência detectada.'), { statusCode: 409 });
      throw error;
    }
    return publicRecord(item);
  }

  async update(auth, entity, id, patch) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.writeGrant || config.grant);
    requireRole(auth, config.write);
    const safePatch = validateUpdate(entity, patch);
    const key = { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id, safePatch) };
    const current = (await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }))).Item;
    if (!current) throw Object.assign(new Error('Registro não encontrado.'), { statusCode: 404 });
    const legacyWithoutVersion = !Number.isInteger(current.version) || current.version < 1;
    if (safePatch.version === undefined && !legacyWithoutVersion) {
      throw Object.assign(new Error('Campo obrigatório: version.'), { statusCode: 400 });
    }
    if (current.deletion_pending) throw Object.assign(new Error('Registro com exclusão pendente.'), { statusCode: 409 });
    this.requireSafeProfileRoleChange(auth, current, safePatch, false);
    if (entity === 'profiles') this.requireSafeProfileUpdate(auth, publicRecord(current), safePatch);
    if (entity === 'completions') this.rejectClientManagedCompletionMetadata(safePatch, false, current);
    const lifecyclePatch = entity === 'completions' ? this.completionTransition(auth, current, safePatch) : safePatch;
    await this.requireUpdatedRelationships(auth, entity, current, lifecyclePatch);
    const expectedVersion = Number(safePatch.version ?? (legacyWithoutVersion ? 1 : current.version));
    if (!legacyWithoutVersion && expectedVersion !== Number(current.version)) {
      throw Object.assign(new Error('O registro foi alterado por outro usuário. Atualize e tente novamente.'), { statusCode: 409 });
    }
    const timestamp = now();
    let structureHistory = current.structure_history;
    if (entity === 'obligations' && obligationStructureChanged(current, lifecyclePatch)) {
      const snapshot = await this.obligationSnapshot(auth, current);
      structureHistory = [
        ...(Array.isArray(current.structure_history) ? current.structure_history : []),
        { effective_until: timestamp, snapshot }
      ];
    }
    const item = {
      ...current,
      ...lifecyclePatch,
      ...(structureHistory ? { structure_history: structureHistory } : {}),
      version: expectedVersion + 1,
      updated_at: timestamp
    };
    const occurrenceChanged = entity === 'completions'
      && (item.obligation_id !== current.obligation_id || item.occurrence_date !== current.occurrence_date);
    const lockChanges = occurrenceChanged
      ? [
          { Delete: {
            TableName: this.tableName,
            Key: { PK: key.PK, SK: `UNIQUE#COMPLETION#${current.obligation_id}#${current.occurrence_date}` },
            ConditionExpression: '#completionId = :completionId',
            ExpressionAttributeNames: { '#completionId': 'completionId' },
            ExpressionAttributeValues: { ':completionId': id }
          } },
          { Put: {
            TableName: this.tableName,
            Item: { PK: key.PK, SK: `UNIQUE#COMPLETION#${item.obligation_id}#${item.occurrence_date}`, entityType: 'uniqueness_lock', completionId: id },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          } }
        ]
      : [];
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: {
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(#version) OR #version = :expectedVersion)',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':expectedVersion': expectedVersion }
        } },
        ...lockChanges,
        ...(entity === 'profiles' ? [memberSyncTransaction(this.tableName, auth.workspaceId, id, item, safePatch)] : []),
        { Put: { TableName: this.tableName, Item: this.auditItem(auth, 'UPDATE', entity, id, publicRecord(current), publicRecord(item)) } }
      ] }));
    } catch (error) {
      if (error.name === 'TransactionCanceledException') throw Object.assign(new Error('Registro já existente ou concorrência detectada.'), { statusCode: 409 });
      throw error;
    }
    return publicRecord(item);
  }

  async remove(auth, entity, id) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.writeGrant || config.grant);
    requireRole(auth, config.write);
    const key = { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id) };
    const current = (await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }))).Item;
    if (!current) return null;
    if (current.deletion_pending && current.deletion_event_id) return { eventId: current.deletion_event_id };
    const timestamp = now(); const eventId = randomUUID();
    const pending = { ...current, deletion_pending: true, deletion_event_id: eventId, deletion_requested_at: timestamp, updated_at: timestamp };
    const outbox = { PK: key.PK, SK: `OUTBOX#DELETE#${eventId}`, id: eventId, entityType: 'file_deletion_outbox', eventType: 'DELETE_ENTITY', workspace_id: auth.workspaceId, entity, entity_id: id, entity_sk: key.SK, attachment_path: current.attachment_path, obligation_id: current.obligation_id, occurrence_date: current.occurrence_date, created_at: timestamp, schemaVersion: SCHEMA_VERSION };
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: pending, ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND attribute_not_exists(deletion_pending)' } },
      { Put: { TableName: this.tableName, Item: outbox, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: this.tableName, Item: this.auditItem(auth, 'DELETE_REQUESTED', entity, id, publicRecord(current), publicRecord(pending)) } }
    ] }));
    return { eventId };
  }

  auditItem(auth, action, entity, entityId, before, after) {
    const timestamp = now(); const id = randomUUID();
    return { PK: tenantPk(auth.workspaceId), SK: `AUDIT#${timestamp}#${id}`, id, entityType: 'audit_log', toolId: TOOL_ID, environment: APP_ENV, workspace_id: auth.workspaceId, action, table_name: entity, record_id: entityId, actor_id: auth.userId, actor_email: auth.email, old_data: before, new_data: after, created_at: timestamp, schemaVersion: SCHEMA_VERSION };
  }

  async obligationSnapshot(auth, obligation) {
    let companyName = '';
    if (obligation?.company_id) {
      const company = (await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(auth.workspaceId), SK: entitySk('companies', obligation.company_id) },
        ConsistentRead: true
      }))).Item;
      companyName = String(company?.name || '');
    }
    return obligationSnapshot(obligation, companyName);
  }

  async requireRelationships(auth, entity, record) {
    for (const [field, targetEntity] of Object.entries(entityRelationships[entity] || {})) {
      const value = record[field];
      if (value == null) continue;
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(auth.workspaceId), SK: entitySk(targetEntity, value) },
        ConsistentRead: true
      }));
      if (!result.Item) throw Object.assign(new Error(`Referência inválida: ${field}.`), { statusCode: 400 });
    }
  }

  async requireUpdatedRelationships(auth, entity, current, patch) {
    const relationships = entityRelationships[entity] || {};
    for (const [field, targetEntity] of Object.entries(relationships)) {
      if (!(field in patch)) continue;
      const value = patch[field];
      if (value === current?.[field] || value == null) continue;
      const result = await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: tenantPk(auth.workspaceId), SK: entitySk(targetEntity, value) },
        ConsistentRead: true
      }));
      if (!result.Item) throw Object.assign(new Error(`Referência inválida: ${field}.`), { statusCode: 400 });
    }
  }

  requireSafeProfileRoleChange(auth, current, patch, creating) {
    if (patch.role === undefined) return;
    if (!['admin', 'super_admin'].includes(auth.role)) {
      throw Object.assign(new Error('Somente o Admin da Ferramenta pode alterar papéis de acesso.'), { statusCode: 403 });
    }
    if (patch.role === 'super_admin' || current?.role === 'super_admin') {
      if (auth.role !== 'super_admin') throw Object.assign(new Error('Somente super_admin pode conceder ou alterar este papel.'), { statusCode: 403 });
    }
    if (!creating && current?.id === auth.userId && patch.role !== current.role) {
      throw Object.assign(new Error('Não é permitido alterar o próprio papel.'), { statusCode: 403 });
    }
  }

  async completionCreateDefaults(auth, validated, timestamp) {
    const obligation = (await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: tenantPk(auth.workspaceId), SK: entitySk('obligations', validated.obligation_id) }, ConsistentRead: true }))).Item;
    if (!obligation) throw Object.assign(new Error('Referência inválida: obligation_id.'), { statusCode: 400 });
    const requiresValidation = obligation.requires_validation === true && !['admin', 'super_admin'].includes(auth.role);
    if (requiresValidation && !obligation.validator_id) throw Object.assign(new Error('A Gestão ainda não definiu o validador desta tarefa.'), { statusCode: 400 });
    if (requiresValidation && obligation.validator_id === auth.userId) throw Object.assign(new Error('O executor não pode validar o próprio trabalho.'), { statusCode: 400 });
    const snapshot = await this.obligationSnapshot(auth, obligation);
    return {
      done_at: validated.done_at || timestamp, done_by: auth.userId,
      status: requiresValidation ? 'aguardando_validacao' : 'validada',
      validator_id: obligation.validator_id || null, submitted_at: validated.submitted_at || timestamp,
      competence_date: competenceDateForOccurrence(obligation, validated.occurrence_date),
      obligation_snapshot: snapshot,
      ...(requiresValidation ? {} : { validated_at: timestamp, validated_by: auth.userId })
    };
  }

  completionTransition(auth, current, patch) {
    const currentStatus = canonicalCompletionStatus(current.status) || current.status;
    if (patch.status === undefined || patch.status === currentStatus) return patch;
    const timestamp = now();
    if (currentStatus === 'aguardando_validacao' && ['validada', 'rejeitada'].includes(patch.status)) {
      if (current.validator_id !== auth.userId) throw Object.assign(new Error('Somente o validador designado pode validar.'), { statusCode: 403 });
      return { ...patch, validator_id: current.validator_id, validated_by: auth.userId, validated_at: timestamp,
        ...(patch.status === 'validada' ? { rejection_reason: null, rejected_at: null } : { rejected_at: timestamp }) };
    }
    if (currentStatus === 'rejeitada' && patch.status === 'aguardando_validacao') {
      if (current.done_by !== auth.userId) throw Object.assign(new Error('Somente o executor pode reenviar para validação.'), { statusCode: 403 });
      return { ...patch, rejection_reason: null, rejected_at: null, validated_at: null, validated_by: null, submitted_at: timestamp };
    }
    throw Object.assign(new Error('Transição de estado inválida.'), { statusCode: 409 });
  }

  rejectClientManagedCompletionMetadata(patch, creating, current = null) {
    const serverFields = ['done_at', 'validator_id', 'submitted_at', 'validated_at', 'validated_by', 'rejected_at'];
    if (creating) serverFields.push('status', 'rejection_reason');
    const statusChanges = !creating && patch.status !== undefined
      && patch.status !== (canonicalCompletionStatus(current?.status) || current?.status);
    const forbidden = serverFields.filter(field => patch[field] !== undefined && (!statusChanges || field === 'done_at'));
    if (!creating && patch.done_by !== undefined) forbidden.push('done_by');
    if (forbidden.length) throw Object.assign(new Error(`Campo controlado pelo servidor: ${forbidden[0]}.`), { statusCode: 403 });
  }
}

const OBLIGATION_STRUCTURE_FIELDS = Object.freeze([
  'name', 'category', 'company_id', 'responsible', 'responsible_id', 'frequency',
  'day_of_month', 'month', 'months', 'due_date', 'competence_offset_months', 'notes',
  'activity_type', 'process_name', 'area_name', 'predecessor_id', 'module_key',
  'requires_attachment', 'requires_attachment_no_movement', 'priority',
  'adjust_business_day', 'day_type', 'business_day_shift', 'requires_validation', 'validator_id'
]);

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function obligationStructureChanged(current, patch) {
  return OBLIGATION_STRUCTURE_FIELDS.some((field) => field in patch && !sameValue(current?.[field], patch[field]));
}

function obligationSnapshot(obligation, companyName = '') {
  const snapshot = {};
  for (const field of OBLIGATION_STRUCTURE_FIELDS) snapshot[field] = obligation?.[field] ?? null;
  snapshot.company_name = companyName || '';
  snapshot.source_version = Number.isInteger(obligation?.version) ? obligation.version : null;
  return snapshot;
}

function competenceDateForOccurrence(obligation, occurrenceDate) {
  const match = /^(\d{4})-(\d{2})/.exec(String(occurrenceDate || ''));
  if (!match) return null;
  const offset = Math.max(0, Math.min(36, Number(obligation?.competence_offset_months || 0)));
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 - offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function encodeCursor(key) {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const key = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!key?.PK || !key?.SK) throw new Error('invalid');
    return key;
  } catch {
    throw Object.assign(new Error('Cursor inválido.'), { statusCode: 400 });
  }
}
