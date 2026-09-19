import { randomUUID } from 'node:crypto';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  DUEDATE_INDEX,
  GENERIC_SCHEMA_VERSION,
  RECORD_LOOKUP_INDEX,
  assertIdentifier,
  assertWorkspaceId,
  dueDateIndexKeys,
  eventSk,
  normalizeDateOnly,
  normalizeTimestamp,
  recordSk,
  relationLookupKeys,
  relationSk,
  workspacePk,
} from './model-generic.mjs';

export { DUEDATE_INDEX, RECORD_LOOKUP_INDEX } from './model-generic.mjs';

function now() {
  return new Date().toISOString();
}

const RESERVED_FIELDS = new Set([
  'PK', 'SK',
  'GSI1PK', 'GSI1SK',
  'GSIRecordPK', 'GSIRecordSK',
  'GSIDueDatePK', 'GSIDueDateSK',
  'workspace_id', 'entityType', 'schemaVersion',
  'module_id', 'record_type', 'record_id',
  'event_id', 'event_type', 'timestamp',
  'relation_id', 'relation_type',
  'related_record_id', 'related_module_id', 'related_record_type',
  'direction', 'created_at', 'updated_at',
]);

function safeData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !RESERVED_FIELDS.has(key)),
  );
}

function withoutInfrastructure(item) {
  if (!item) return null;
  const {
    PK,
    SK,
    GSI1PK,
    GSI1SK,
    GSIRecordPK,
    GSIRecordSK,
    GSIDueDatePK,
    GSIDueDateSK,
    ...record
  } = item;
  return record;
}

function encodeCursor(key, scope) {
  return Buffer.from(JSON.stringify({ key, scope }), 'utf8').toString('base64url');
}

function decodeCursor(cursor, expectedScope, { requireWorkspacePk = true } = {}) {
  try {
    const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const key = decoded?.key;
    const scope = decoded?.scope;
    if (!key?.PK || !key?.SK) throw new Error('invalid');
    if (
      scope?.workspaceId !== expectedScope.workspaceId
      || scope?.kind !== expectedScope.kind
      || (expectedScope.recordId && scope?.recordId !== expectedScope.recordId)
    ) throw new Error('invalid');
    if (requireWorkspacePk && key.PK !== workspacePk(expectedScope.workspaceId)) throw new Error('invalid');
    return key;
  } catch {
    throw Object.assign(new Error('Cursor inválido para esta consulta.'), { statusCode: 400 });
  }
}

function safeLimit(limit) {
  return Math.min(Math.max(Number(limit) || 100, 1), 100);
}

function sameWorkspace(items, workspaceId) {
  const expectedPk = workspacePk(workspaceId);
  return (items || []).filter((item) => item?.workspace_id === workspaceId && item?.PK === expectedPk);
}

export class GenericRepository {
  constructor(client, tableName) {
    this.client = client;
    this.tableName = tableName;
  }

  async putRecord(workspaceId, input) {
    const workspace = assertWorkspaceId(workspaceId);
    const moduleId = assertIdentifier(input?.moduleId, 'moduleId');
    const recordType = assertIdentifier(input?.recordType, 'recordType');
    const recordId = assertIdentifier(input?.recordId || randomUUID(), 'recordId');
    const timestamp = now();
    const dueDate = normalizeDateOnly(input?.dueDate);
    const payload = safeData(input?.data);

    const item = {
      ...payload,
      PK: workspacePk(workspace),
      SK: recordSk(moduleId, recordType, recordId),
      workspace_id: workspace,
      module_id: moduleId,
      record_type: recordType,
      record_id: recordId,
      entityType: 'record',
      schemaVersion: GENERIC_SCHEMA_VERSION,
      created_at: input?.createdAt ? normalizeTimestamp(input.createdAt) : timestamp,
      updated_at: timestamp,
      ...(dueDate ? {
        due_date: dueDate,
        ...dueDateIndexKeys(workspace, dueDate, recordId),
      } : {}),
    };

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }));

    return withoutInfrastructure(item);
  }

  async getRecord(workspaceId, moduleId, recordType, recordId) {
    const workspace = assertWorkspaceId(workspaceId);
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: workspacePk(workspace),
        SK: recordSk(moduleId, recordType, recordId),
      },
      ConsistentRead: true,
    }));

    if (
      result.Item?.workspace_id !== workspace
      || result.Item?.PK !== workspacePk(workspace)
      || result.Item?.SK !== recordSk(moduleId, recordType, recordId)
    ) return null;
    return withoutInfrastructure(result.Item);
  }

  async updateRecord(workspaceId, moduleId, recordType, recordId, patch = {}) {
    const workspace = assertWorkspaceId(workspaceId);
    const key = {
      PK: workspacePk(workspace),
      SK: recordSk(moduleId, recordType, recordId),
    };
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: true,
    }));
    const current = result.Item;
    if (
      current?.workspace_id !== workspace
      || current?.PK !== key.PK
      || current?.SK !== key.SK
    ) {
      throw Object.assign(new Error('Registro não encontrado.'), { statusCode: 404 });
    }

    const safePatch = safeData(patch.data);
    const expectedVersion = Number(patch.expectedVersion ?? current.version ?? 1);
    if (expectedVersion !== Number(current.version ?? 1)) {
      throw Object.assign(new Error('O registro foi alterado por outro usuário.'), { statusCode: 409 });
    }

    const dueDate = patch.dueDate === undefined
      ? current.due_date
      : normalizeDateOnly(patch.dueDate);

    const next = {
      ...current,
      ...safePatch,
      version: expectedVersion + 1,
      updated_at: now(),
    };

    delete next.GSIDueDatePK;
    delete next.GSIDueDateSK;
    if (dueDate) {
      next.due_date = dueDate;
      Object.assign(next, dueDateIndexKeys(workspace, dueDate, recordId));
    } else if (patch.dueDate !== undefined) {
      next.due_date = null;
    }

    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: next,
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND (attribute_not_exists(#version) OR #version = :expectedVersion)',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
      }));
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') {
        throw Object.assign(new Error('O registro foi alterado por outro usuário.'), { statusCode: 409 });
      }
      throw error;
    }

    return withoutInfrastructure(next);
  }

  async deleteRecord(workspaceId, moduleId, recordType, recordId) {
    const workspace = assertWorkspaceId(workspaceId);
    const key = {
      PK: workspacePk(workspace),
      SK: recordSk(moduleId, recordType, recordId),
    };
    const current = await this.getRecord(workspace, moduleId, recordType, recordId);
    if (!current) return null;

    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: key,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    }));
    return current;
  }

  async queryRecordsByModule(workspaceId, moduleId, { recordType, limit = 100, cursor } = {}) {
    const workspace = assertWorkspaceId(workspaceId);
    const module = assertIdentifier(moduleId, 'moduleId');
    const prefix = recordType
      ? `RECORD#${module}#${assertIdentifier(recordType, 'recordType')}#`
      : `RECORD#${module}#`;
    const pk = workspacePk(workspace);

    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': prefix,
      },
      Limit: safeLimit(limit),
      ExclusiveStartKey: cursor
        ? decodeCursor(cursor, { workspaceId: workspace, kind: 'records' })
        : undefined,
    }));

    return {
      items: sameWorkspace(result.Items, workspace).map(withoutInfrastructure),
      cursor: result.LastEvaluatedKey
        ? encodeCursor(result.LastEvaluatedKey, { workspaceId: workspace, kind: 'records' })
        : null,
    };
  }

  async putRelation(workspaceId, input) {
    const workspace = assertWorkspaceId(workspaceId);
    const source = {
      moduleId: assertIdentifier(input?.recordModuleId, 'recordModuleId'),
      recordType: assertIdentifier(input?.recordType, 'recordType'),
      recordId: assertIdentifier(input?.recordId, 'recordId'),
    };
    const target = {
      moduleId: assertIdentifier(input?.relatedModuleId || input?.recordModuleId, 'relatedModuleId'),
      recordType: assertIdentifier(input?.relatedRecordType || input?.recordType, 'relatedRecordType'),
      recordId: assertIdentifier(input?.relatedRecordId, 'relatedRecordId'),
    };

    if (source.recordId === target.recordId) {
      throw Object.assign(new Error('Relação reflexiva não é suportada.'), { statusCode: 400 });
    }

    const [sourceResult, targetResult] = await Promise.all([
      this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: workspacePk(workspace), SK: recordSk(source.moduleId, source.recordType, source.recordId) },
        ConsistentRead: true,
      })),
      this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: workspacePk(workspace), SK: recordSk(target.moduleId, target.recordType, target.recordId) },
        ConsistentRead: true,
      })),
    ]);

    const expectedPk = workspacePk(workspace);
    if (
      sourceResult.Item?.workspace_id !== workspace
      || sourceResult.Item?.PK !== expectedPk
      || targetResult.Item?.workspace_id !== workspace
      || targetResult.Item?.PK !== expectedPk
    ) {
      throw Object.assign(new Error('Relação exige dois RECORDs existentes no mesmo workspace.'), { statusCode: 400 });
    }

    const timestamp = now();
    const relationId = input?.relationId || randomUUID();
    const data = safeData(input?.data);

    const adjacency = (record, relatedRecord, direction) => ({
      ...data,
      PK: workspacePk(workspace),
      SK: relationSk(record.recordId, relatedRecord.recordId),
      workspace_id: workspace,
      entityType: 'relation',
      schemaVersion: GENERIC_SCHEMA_VERSION,
      relation_id: relationId,
      relation_type: input?.relationType || 'related',
      record_id: record.recordId,
      record_module_id: record.moduleId,
      record_type: record.recordType,
      related_record_id: relatedRecord.recordId,
      related_module_id: relatedRecord.moduleId,
      related_record_type: relatedRecord.recordType,
      direction,
      ...relationLookupKeys(record.recordId, relatedRecord.recordId),
      created_at: input?.createdAt ? normalizeTimestamp(input.createdAt) : timestamp,
      updated_at: timestamp,
    });

    const forward = adjacency(source, target, 'outbound');
    const reverse = adjacency(target, source, 'inbound');

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        { Put: {
          TableName: this.tableName,
          Item: forward,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        } },
        { Put: {
          TableName: this.tableName,
          Item: reverse,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        } },
      ],
    }));

    return withoutInfrastructure(forward);
  }

  async listRelationsOfRecord(workspaceId, recordId, { limit = 100, cursor } = {}) {
    const workspace = assertWorkspaceId(workspaceId);
    const id = assertIdentifier(recordId, 'recordId');
    const pk = workspacePk(workspace);
    const requestedLimit = safeLimit(limit);
    const scope = { workspaceId: workspace, kind: 'relations', recordId: id };
    let exclusiveStartKey = cursor ? decodeCursor(cursor, scope) : undefined;
    const ownItems = [];
    let hasMoreEvaluatedItems = false;

    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: RECORD_LOOKUP_INDEX,
        KeyConditionExpression: 'GSIRecordPK = :recordPk AND begins_with(GSIRecordSK, :relationPrefix)',
        FilterExpression: 'workspace_id = :workspaceId AND PK = :workspacePk',
        ExpressionAttributeValues: {
          ':recordPk': `RECORD#${id}`,
          ':relationPrefix': 'RELATION#',
          ':workspaceId': workspace,
          ':workspacePk': pk,
        },
        Limit: 100,
        ExclusiveStartKey: exclusiveStartKey,
      }));

      ownItems.push(
        ...sameWorkspace(result.Items, workspace)
          .filter((item) => item.GSIRecordPK === `RECORD#${id}`),
      );

      exclusiveStartKey = result.LastEvaluatedKey;
      hasMoreEvaluatedItems = Boolean(exclusiveStartKey);
    } while (ownItems.length <= requestedLimit && hasMoreEvaluatedItems);

    const pageItems = ownItems.slice(0, requestedLimit);
    const lastOwnItem = pageItems.at(-1);
    const hasMoreOwnItems = ownItems.length > requestedLimit || hasMoreEvaluatedItems;

    const nextCursor = hasMoreOwnItems && lastOwnItem
      ? encodeCursor(
        {
          PK: lastOwnItem.PK,
          SK: lastOwnItem.SK,
          GSIRecordPK: lastOwnItem.GSIRecordPK,
          GSIRecordSK: lastOwnItem.GSIRecordSK,
        },
        scope,
      )
      : null;

    // A GSI pode conter o mesmo recordId em workspaces diferentes. O filtro do
    // DynamoDB reduz a leitura lógica e esta segunda barreira impede qualquer
    // item fora da partição solicitada de chegar à resposta.
    return {
      items: pageItems.map(withoutInfrastructure),
      cursor: nextCursor,
    };
  }

  async putEvent(workspaceId, input) {
    const workspace = assertWorkspaceId(workspaceId);
    const eventId = assertIdentifier(input?.eventId || randomUUID(), 'eventId');
    const timestamp = normalizeTimestamp(input?.timestamp || now());
    const payload = safeData(input?.data);

    const item = {
      ...payload,
      PK: workspacePk(workspace),
      SK: eventSk(timestamp, eventId),
      workspace_id: workspace,
      entityType: 'event',
      schemaVersion: GENERIC_SCHEMA_VERSION,
      event_id: eventId,
      event_type: input?.eventType || 'event',
      timestamp,
      actor_id: input?.actorId || null,
      module_id: input?.moduleId ? assertIdentifier(input.moduleId, 'moduleId') : null,
      created_at: timestamp,
    };

    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }));

    return withoutInfrastructure(item);
  }

  async listEventsSince(workspaceId, since, { limit = 100, cursor } = {}) {
    const workspace = assertWorkspaceId(workspaceId);
    const pk = workspacePk(workspace);
    const sinceIso = normalizeTimestamp(since);

    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':from': `EVENT#${sinceIso}#`,
        ':to': 'EVENT#\uffff',
      },
      ScanIndexForward: true,
      Limit: safeLimit(limit),
      ExclusiveStartKey: cursor
        ? decodeCursor(cursor, { workspaceId: workspace, kind: 'events' })
        : undefined,
    }));

    return {
      items: sameWorkspace(result.Items, workspace)
        .filter((item) => item.SK?.startsWith('EVENT#'))
        .map(withoutInfrastructure),
      cursor: result.LastEvaluatedKey
        ? encodeCursor(result.LastEvaluatedKey, { workspaceId: workspace, kind: 'events' })
        : null,
    };
  }
}

export function putRecord(client, tableName, workspaceId, input) {
  return new GenericRepository(client, tableName).putRecord(workspaceId, input);
}

export function getRecord(client, tableName, workspaceId, moduleId, recordType, recordId) {
  return new GenericRepository(client, tableName).getRecord(workspaceId, moduleId, recordType, recordId);
}

export function queryRecordsByModule(client, tableName, workspaceId, moduleId, options) {
  return new GenericRepository(client, tableName).queryRecordsByModule(workspaceId, moduleId, options);
}

export function putRelation(client, tableName, workspaceId, input) {
  return new GenericRepository(client, tableName).putRelation(workspaceId, input);
}

export function listRelationsOfRecord(client, tableName, workspaceId, recordId, options) {
  return new GenericRepository(client, tableName).listRelationsOfRecord(workspaceId, recordId, options);
}

export function putEvent(client, tableName, workspaceId, input) {
  return new GenericRepository(client, tableName).putEvent(workspaceId, input);
}

export function listEventsSince(client, tableName, workspaceId, since, options) {
  return new GenericRepository(client, tableName).listEventsSince(workspaceId, since, options);
}

export function updateRecord(client, tableName, workspaceId, moduleId, recordType, recordId, patch) {
  return new GenericRepository(client, tableName).updateRecord(workspaceId, moduleId, recordType, recordId, patch);
}

export function deleteRecord(client, tableName, workspaceId, moduleId, recordType, recordId) {
  return new GenericRepository(client, tableName).deleteRecord(workspaceId, moduleId, recordType, recordId);
}
