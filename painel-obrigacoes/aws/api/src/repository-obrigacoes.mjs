import { createHash, randomUUID } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { requireModuleGrant, requireRole } from './auth.mjs';
import { entitySk, tenantPk } from './model.mjs';
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

const OBLIGATION_STRUCTURE_FIELDS = Object.freeze([
  'name', 'category', 'company_id', 'responsible', 'responsible_id', 'frequency',
  'day_of_month', 'month', 'months', 'due_date', 'competence_offset_months', 'notes',
  'activity_type', 'process_name', 'area_name', 'predecessor_id', 'module_key',
  'requires_attachment', 'requires_attachment_no_movement', 'priority',
  'adjust_business_day', 'day_type', 'business_day_shift', 'requires_validation', 'validator_id',
]);

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function obligationStructureChanged(current, patch) {
  return OBLIGATION_STRUCTURE_FIELDS.some((field) => (
    Object.hasOwn(patch || {}, field) && !sameValue(current?.[field], patch[field])
  ));
}

function snapshotFields(obligation, companyName = '') {
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
    this.client = client;
    this.tableName = tableName;
    this.generic = new GenericRepository(client, tableName);
  }

  async obligationSnapshot(auth, obligation) {
    let companyName = '';
    if (obligation?.company_id) {
      const company = (await this.client.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: tenantPk(auth.workspaceId),
          SK: entitySk('companies', obligation.company_id),
        },
        ConsistentRead: true,
      }))).Item;
      companyName = String(company?.name || '');
    }
    return snapshotFields(obligation, companyName);
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

    const activity = entity !== 'obligations'
      ? legacyRecord(await this.assertActivityExists(auth, input.obligation_id))
      : null;

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
      if (input.done_by && input.done_by !== auth.userId) {
        throw Object.assign(new Error('Não é permitido concluir em nome de outro usuário.'), { statusCode: 403 });
      }
      this.rejectClientManagedCompletionMetadata(input, true);
      recordId = occurrenceRecordId(input);
      const defaults = await this.completionCreateDefaults(auth, activity, input, createdAt);
      data = {
        ...publicData(input),
        ...defaults,
        id: recordId,
        version: 1,
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

    let publicPatch = publicData(patch);
    if (entity === 'completions') {
      this.rejectClientManagedCompletionMetadata(publicPatch, false, current);
      publicPatch = this.completionTransition(auth, current, publicPatch);
      publicPatch.competence_date = current.competence_date ?? publicPatch.competence_date;
      publicPatch.obligation_snapshot = current.obligation_snapshot ?? publicPatch.obligation_snapshot;
    }
    if (entity === 'obligations' && obligationStructureChanged(current, patch)) {
      const snapshot = await this.obligationSnapshot(auth, current);
      publicPatch.structure_history = [
        ...(Array.isArray(current.structure_history) ? current.structure_history : []),
        { effective_until: timestamp(), snapshot },
      ];
    }

    const data = {
      ...publicPatch,
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

  async completionCreateDefaults(auth, activity, input, createdAt) {
    const checklistItems = await this.requireCompletionReady(auth, activity, input);
    const requiresValidation = activity.requires_validation === true
      && !['admin', 'super_admin'].includes(auth.role);

    if (requiresValidation && !activity.validator_id) {
      throw Object.assign(new Error('A Gestão ainda não definiu o validador desta tarefa.'), { statusCode: 400 });
    }
    if (requiresValidation && activity.validator_id === auth.userId) {
      throw Object.assign(new Error('O executor não pode validar o próprio trabalho.'), { statusCode: 400 });
    }

    const snapshot = await this.obligationSnapshot(auth, activity);
    const checked = checklistItems.filter((item) => item.done === true || item.completed === true).length;
    return {
      done_at: input.done_at || createdAt,
      done_by: auth.userId,
      status: requiresValidation ? 'aguardando_validacao' : 'validada',
      validator_id: activity.validator_id || null,
      submitted_at: input.submitted_at || createdAt,
      checklist_total: checklistItems.length,
      checklist_checked: checked,
      competence_date: competenceDateForOccurrence(activity, input.occurrence_date),
      obligation_snapshot: snapshot,
      ...(requiresValidation ? {} : { validated_at: createdAt, validated_by: auth.userId }),
    };
  }

  async requireCompletionReady(auth, activity, input) {
    const checklistItems = (await this.listAll(auth, 'checklist-item'))
      .filter((item) => item.obligation_id === activity.id);
    const pending = checklistItems.filter((item) => !(item.done === true || item.completed === true));
    if (pending.length) {
      throw Object.assign(new Error(`Checklist incompleto: faltam ${pending.length} item(ns) antes de concluir.`), { statusCode: 400 });
    }

    const noMovementException = activity.activity_type === 'obrigacao_acessoria'
      && activity.requires_attachment_no_movement === false
      && input.movement_status === 'sem_movimento';
    const requiresAttachment = activity.requires_attachment !== false && !noMovementException;
    if (requiresAttachment && !input.attachment_path) {
      throw Object.assign(new Error('Comprovante obrigatório: anexe o arquivo antes de concluir.'), { statusCode: 400 });
    }
    return checklistItems;
  }

  completionTransition(auth, current, patch) {
    const currentStatus = current.status || 'validada';
    if (patch.status === undefined || patch.status === currentStatus) return patch;
    const nowValue = timestamp();

    if (currentStatus === 'aguardando_validacao' && ['validada', 'rejeitada'].includes(patch.status)) {
      if (current.validator_id !== auth.userId) {
        throw Object.assign(new Error('Somente o validador designado pode validar.'), { statusCode: 403 });
      }
      if (patch.status === 'rejeitada' && String(patch.rejection_reason || '').trim().length < 10) {
        throw Object.assign(new Error('Descreva o que precisa ser corrigido (mínimo 10 caracteres).'), { statusCode: 400 });
      }
      return {
        ...patch,
        validator_id: current.validator_id,
        validated_by: auth.userId,
        validated_at: nowValue,
        ...(patch.status === 'validada'
          ? { rejection_reason: null, rejected_at: null }
          : { rejected_at: nowValue }),
      };
    }

    if (currentStatus === 'rejeitada' && patch.status === 'aguardando_validacao') {
      if (current.done_by !== auth.userId) {
        throw Object.assign(new Error('Somente o executor pode reenviar para validação.'), { statusCode: 403 });
      }
      return {
        ...patch,
        rejection_reason: null,
        rejected_at: null,
        validated_at: null,
        validated_by: null,
        submitted_at: nowValue,
      };
    }

    throw Object.assign(new Error('Transição de estado inválida.'), { statusCode: 409 });
  }

  rejectClientManagedCompletionMetadata(patch, creating, current = null) {
    const serverFields = ['done_at', 'validator_id', 'submitted_at', 'validated_at', 'validated_by', 'rejected_at'];
    if (creating) serverFields.push('status', 'rejection_reason');
    const statusChanges = !creating && patch.status !== undefined && patch.status !== current?.status;
    const forbidden = serverFields.filter((field) => (
      patch[field] !== undefined && (!statusChanges || field === 'done_at')
    ));
    if (!creating && patch.done_by !== undefined) forbidden.push('done_by');
    if (forbidden.length) {
      throw Object.assign(new Error(`Campo controlado pelo servidor: ${forbidden[0]}.`), { statusCode: 403 });
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
