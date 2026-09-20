import { randomUUID } from 'node:crypto';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { entityConfig, entitySk, publicRecord, SCHEMA_VERSION, tenantPk, TOOL_ID, APP_ENV } from './model.mjs';
import { memberIndexKeys, memberSk, workspacePk } from './model-generic.mjs';
import { requireModuleGrant, requireRole } from './auth.mjs';

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
      if (forbidden.length) {
        throw Object.assign(new Error('A delegação administrativa não permite alterar papel, vínculo ou concessões de segurança.'), { statusCode: 403 });
      }
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
      items: (result.Items || []).map(publicRecord),
      cursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : null
    };
  }

  async get(auth, entity, id) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.readGrant || config.grant);
    requireRole(auth, config.read);
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id) } }));
    return publicRecord(result.Item);
  }

  async create(auth, entity, input) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.writeGrant || config.grant);
    requireRole(auth, config.write);
    const id = input.id || randomUUID();
    const timestamp = now();
    const entityDefaults = entity === 'completions'
      ? { done_at: input.done_at || timestamp }
      : {};
    const record = { ...input, ...entityDefaults, id, version: 1, toolId: TOOL_ID, environment: APP_ENV, workspace_id: auth.workspaceId, entityType: entity, schemaVersion: SCHEMA_VERSION, created_at: input.created_at || timestamp, updated_at: timestamp };
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
    const key = { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id, patch) };
    const current = (await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }))).Item;
    if (!current) throw Object.assign(new Error('Registro não encontrado.'), { statusCode: 404 });
    if (entity === 'profiles') this.requireSafeProfileUpdate(auth, publicRecord(current), patch);
    const immutable = new Set(['PK', 'SK', 'workspace_id', 'toolId', 'environment', 'entityType', 'schemaVersion', 'created_at', 'id']);
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([keyName]) => !immutable.has(keyName)));
    const expectedVersion = Number(patch.version ?? current.version ?? 1);
    if (expectedVersion !== Number(current.version ?? 1)) throw Object.assign(new Error('O registro foi alterado por outro usuário. Atualize e tente novamente.'), { statusCode: 409 });
    const item = { ...current, ...safePatch, version: expectedVersion + 1, updated_at: now() };
    const transactItems = [
      { Put: {
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(#version) OR #version = :expectedVersion)',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':expectedVersion': expectedVersion }
      } },
      ...(entity === 'profiles'
        ? [memberSyncTransaction(this.tableName, auth.workspaceId, id, item, patch)]
        : []),
      { Put: { TableName: this.tableName, Item: this.auditItem(auth, 'UPDATE', entity, id, publicRecord(current), publicRecord(item)) } }
    ];
    await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    return publicRecord(item);
  }

  async remove(auth, entity, id) {
    const config = entityConfig(entity);
    requireModuleGrant(auth, config.writeGrant || config.grant);
    requireRole(auth, config.write);
    const key = { PK: tenantPk(auth.workspaceId), SK: entitySk(entity, id) };
    const current = (await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: true }))).Item;
    if (!current) return;
    const uniqueDelete = entity === 'completions'
      ? { Delete: { TableName: this.tableName, Key: { PK: key.PK, SK: `UNIQUE#COMPLETION#${current.obligation_id}#${current.occurrence_date}` } } }
      : null;
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Delete: { TableName: this.tableName, Key: key, ConditionExpression: 'attribute_exists(PK)' } },
      ...(uniqueDelete ? [uniqueDelete] : []),
      { Put: { TableName: this.tableName, Item: this.auditItem(auth, 'DELETE', entity, id, publicRecord(current), null) } }
    ] }));
  }

  auditItem(auth, action, entity, entityId, before, after) {
    const timestamp = now(); const id = randomUUID();
    return { PK: tenantPk(auth.workspaceId), SK: `AUDIT#${timestamp}#${id}`, id, entityType: 'audit_log', toolId: TOOL_ID, environment: APP_ENV, workspace_id: auth.workspaceId, action, table_name: entity, record_id: entityId, actor_id: auth.userId, actor_email: auth.email, old_data: before, new_data: after, created_at: timestamp, schemaVersion: SCHEMA_VERSION };
  }
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
