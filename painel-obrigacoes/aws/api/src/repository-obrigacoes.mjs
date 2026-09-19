import { createHash, randomUUID } from 'node:crypto';
import { requireModuleGrant, requireRole } from './auth.mjs';
import { GenericRepository } from './repository-generic.mjs';

const MODULE_ID = 'obrigacoes';
const ALLOWED_ROLES = Object.freeze(['member', 'manager', 'admin', 'super_admin']);

const ENTITY_MAP = Object.freeze({
  obligations: Object.freeze({ recordType: 'activity' }),
  completions: Object.freeze({ recordType: 'occurrence' }),
  checklist_items: Object.freeze({ recordType: 'checklist-item' }),
});

function timestamp() {
  return new Date().toISOString();
}

function provenance(auth, operation, previous) {
  return {
    source: 'user',
    origin: 'painel-obrigacoes',
    actor_id: auth.userId || null,
    operation,
    captured_at: timestamp(),
    ...(previous?.source_record_id ? { source_record_id: previous.source_record_id } : {}),
  };
}

function assertCoreAccess(auth) {
  requireModuleGrant(auth, MODULE_ID);
  requireRole(auth, ALLOWED_ROLES);
}

function configFor(entity) {
  return ENTITY_MAP[entity] || null;
}

function legacyRecord(record) {
  if (!record) return null;
  const {
    module_id,
    record_type,
    record_id,
    entityType,
    schemaVersion,
    provenance: _provenance,
    ...legacy
  } = record;
  return {
    ...legacy,
    id: legacy.id || record_id,
  };
}

function occurrenceRecordId(input) {
  const activityId = String(input?.obligation_id || '').trim();
  const occurrenceDate = String(input?.occurrence_date || '').trim();
  if (!activityId || !occurrenceDate) {
    throw Object.assign(new Error('obligation_id e occurrence_date são obrigatórios.'), { statusCode: 400 });
  }
  return `${activityId}:${occurrenceDate}`;
}

function evidenceRecordId(occurrenceId) {
  const digest = createHash('sha256').update(String(occurrenceId), 'utf8').digest('hex').slice(0, 40);
  return `evidence-${digest}`;
}

function publicData(input = {}) {
  const { id: _id, version: _version, workspace_id: _workspaceId, ...data } = input;
  return data;
}

function mapConditional(error) {
  if (error?.name === 'ConditionalCheckFailedException') {
    throw Object.assign(new Error('Registro já existente ou concorrência detectada.'), { statusCode: 409 });
  }
  throw error;
}

export class ObrigacoesRepository {
  constructor(client, tableName) {
    this.generic = new GenericRepository(client, tableName);
  }

  supports(entity) {
    return Boolean(configFor(entity));
  }

  async list(auth, entity, options = {}) {
    assertCoreAccess(auth);
    const config = configFor(entity);
    if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });

    const page = await this.generic.queryRecordsByModule(
      auth.workspaceId,
      MODULE_ID,
      { ...options, recordType: config.recordType },
    );

    return {
      items: page.items.map(legacyRecord),
      cursor: page.cursor,
    };
  }

  async get(auth, entity, id) {
    assertCoreAccess(auth);
    const config = configFor(entity);
    if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });
    return legacyRecord(await this.generic.getRecord(
      auth.workspaceId,
      MODULE_ID,
      config.recordType,
      id,
    ));
  }

  async create(auth, entity, input = {}) {
    assertCoreAccess(auth);
    const config = configFor(entity);
    if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });

    const createdAt = input.created_at || timestamp();
    let recordId;
    let data;
    let dueDate;

    if (entity !== 'obligations') {
      await this.assertActivityExists(auth, input.obligation_id);
    }

    if (entity === 'obligations') {
      recordId = input.id || randomUUID();
      data = {
        ...publicData(input),
        id: recordId,
        version: 1,
        provenance: provenance(auth, 'create'),
      };
      dueDate = input.due_date || undefined;
    } else if (entity === 'completions') {
      recordId = occurrenceRecordId(input);
      data = {
        ...publicData(input),
        id: recordId,
        version: 1,
        done_at: input.done_at || createdAt,
        provenance: provenance(auth, 'create'),
      };
    } else {
      recordId = input.id || randomUUID();
      data = {
        done: false,
        completed_at: null,
        completed_by: null,
        ...publicData(input),
        id: recordId,
        version: 1,
        provenance: provenance(auth, 'create'),
      };
    }

    let created;
    try {
      created = await this.generic.putRecord(auth.workspaceId, {
        moduleId: MODULE_ID,
        recordType: config.recordType,
        recordId,
        dueDate,
        createdAt,
        data,
      });
    } catch (error) {
      mapConditional(error);
    }

    if (entity === 'completions' && created.attachment_path) {
      try {
        await this.syncEvidence(auth, legacyRecord(created));
      } catch (error) {
        await this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'occurrence', recordId).catch(() => {});
        throw error;
      }
    }

    return legacyRecord(created);
  }

  async update(auth, entity, id, patch = {}) {
    assertCoreAccess(auth);
    const config = configFor(entity);
    if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });

    const current = await this.get(auth, entity, id);
    if (!current) throw Object.assign(new Error('Registro não encontrado.'), { statusCode: 404 });

    const data = {
      ...publicData(patch),
      id: current.id,
      provenance: provenance(auth, 'update', current.provenance),
    };

    const updated = await this.generic.updateRecord(
      auth.workspaceId,
      MODULE_ID,
      config.recordType,
      id,
      {
        data,
        expectedVersion: patch.version ?? current.version,
        ...(entity === 'obligations' && Object.hasOwn(patch, 'due_date')
          ? { dueDate: patch.due_date || null }
          : {}),
      },
    );

    const legacy = legacyRecord(updated);
    if (entity === 'completions' && Object.hasOwn(patch, 'attachment_path')) {
      await this.syncEvidence(auth, legacy);
    }
    return legacy;
  }

  async remove(auth, entity, id) {
    assertCoreAccess(auth);
    const config = configFor(entity);
    if (!config) throw Object.assign(new Error('Recurso desconhecido.'), { statusCode: 404 });

    if (entity === 'obligations') {
      await this.removeActivityAggregate(auth, id);
      return;
    }

    const current = await this.get(auth, entity, id);
    if (!current) return;

    await this.generic.deleteRecord(auth.workspaceId, MODULE_ID, config.recordType, id);

    if (entity === 'completions') {
      await this.generic.deleteRecord(
        auth.workspaceId,
        MODULE_ID,
        'evidence',
        evidenceRecordId(id),
      ).catch(() => null);
    }
  }

  async assertActivityExists(auth, activityId) {
    if (!activityId) {
      throw Object.assign(new Error('obligation_id é obrigatório.'), { statusCode: 400 });
    }
    const activity = await this.generic.getRecord(
      auth.workspaceId,
      MODULE_ID,
      'activity',
      activityId,
    );
    if (!activity) {
      throw Object.assign(new Error('Atividade não encontrada neste workspace.'), { statusCode: 404 });
    }
    return activity;
  }

  async syncEvidence(auth, occurrence) {
    const id = evidenceRecordId(occurrence.id);
    const current = await this.generic.getRecord(
      auth.workspaceId,
      MODULE_ID,
      'evidence',
      id,
    );

    if (!occurrence.attachment_path) {
      if (current) {
        await this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'evidence', id);
      }
      return null;
    }

    const data = {
      id,
      obligation_id: occurrence.obligation_id,
      occurrence_id: occurrence.id,
      attachment_path: occurrence.attachment_path,
      storage_provider: 's3',
      version: current?.version || 1,
      provenance: provenance(auth, current ? 'update' : 'create'),
    };

    if (current) {
      return this.generic.updateRecord(
        auth.workspaceId,
        MODULE_ID,
        'evidence',
        id,
        { data, expectedVersion: current.version },
      );
    }

    return this.generic.putRecord(auth.workspaceId, {
      moduleId: MODULE_ID,
      recordType: 'evidence',
      recordId: id,
      data,
    });
  }

  async removeActivityAggregate(auth, activityId) {
    const activity = await this.get(auth, 'obligations', activityId);
    if (!activity) return;

    const [occurrences, checklist, evidence] = await Promise.all([
      this.listAll(auth, 'occurrence'),
      this.listAll(auth, 'checklist-item'),
      this.listAll(auth, 'evidence'),
    ]);

    const deletes = [
      ...occurrences
        .filter((item) => item.obligation_id === activityId)
        .map((item) => this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'occurrence', item.id)),
      ...checklist
        .filter((item) => item.obligation_id === activityId)
        .map((item) => this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'checklist-item', item.id)),
      ...evidence
        .filter((item) => item.obligation_id === activityId)
        .map((item) => this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'evidence', item.id)),
    ];

    await Promise.all(deletes);
    await this.generic.deleteRecord(auth.workspaceId, MODULE_ID, 'activity', activityId);
  }

  async listAll(auth, recordType) {
    const items = [];
    let cursor;
    do {
      const page = await this.generic.queryRecordsByModule(
        auth.workspaceId,
        MODULE_ID,
        { recordType, limit: 100, cursor },
      );
      items.push(...page.items.map(legacyRecord));
      cursor = page.cursor;
    } while (cursor);
    return items;
  }
}

export const obrigacoesRecordTypes = Object.freeze({
  obligations: 'activity',
  completions: 'occurrence',
  checklist_items: 'checklist-item',
  evidence: 'evidence',
});
