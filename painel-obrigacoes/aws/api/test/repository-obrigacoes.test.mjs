import assert from 'node:assert/strict';
import test from 'node:test';
import { ObrigacoesRepository } from '../src/repository-obrigacoes.mjs';

const auth = {
  workspaceId: 'empresa-a',
  userId: 'user-a',
  role: 'member',
  email: 'user@empresa.test',
  moduleGrants: ['obrigacoes'],
};

class MemoryDocumentClient {
  constructor() {
    this.items = new Map();
  }

  keyOf(key) {
    return `${key.PK}|${key.SK}`;
  }

  clone(value) {
    return value == null ? value : structuredClone(value);
  }

  conditionalError() {
    const error = new Error('conditional');
    error.name = 'ConditionalCheckFailedException';
    return error;
  }

  async send(command) {
    const input = command.input;
    const name = command.constructor.name;

    if (name === 'GetCommand') {
      return { Item: this.clone(this.items.get(this.keyOf(input.Key))) };
    }

    if (name === 'PutCommand') {
      const key = this.keyOf(input.Item);
      const current = this.items.get(key);

      if (input.ConditionExpression?.includes('attribute_not_exists(PK)') && current) {
        throw this.conditionalError();
      }

      if (input.ConditionExpression?.includes('#version = :expectedVersion')) {
        if (!current || Number(current.version ?? 1) !== Number(input.ExpressionAttributeValues[':expectedVersion'])) {
          throw this.conditionalError();
        }
      }

      this.items.set(key, this.clone(input.Item));
      return {};
    }

    if (name === 'DeleteCommand') {
      const key = this.keyOf(input.Key);
      const current = this.items.get(key);
      this.items.delete(key);
      return { Attributes: this.clone(current) };
    }

    if (name === 'QueryCommand') {
      const values = input.ExpressionAttributeValues || {};
      const pk = values[':pk'];
      const prefix = values[':prefix'];
      const items = [...this.items.values()]
        .filter((item) => (!pk || item.PK === pk) && (!prefix || item.SK.startsWith(prefix)))
        .sort((a, b) => a.SK.localeCompare(b.SK));
      return { Items: this.clone(items) };
    }

    throw new Error(`Comando não suportado no teste: ${name}`);
  }
}

function findBySk(client, skPrefix) {
  return [...client.items.values()].filter((item) => item.SK.startsWith(skPrefix));
}

async function seedActiveEntitlement(repository, workspaceId = 'empresa-a') {
  await repository.generic.putEntitlement(workspaceId, {
    moduleId: 'obrigacoes',
    plan: 'standard',
    status: 'ativo',
    startedAt: '2026-09-01T00:00:00Z',
    renewsAt: '2026-10-01T00:00:00Z',
  });
}

test('obligations mantém contrato HTTP legado e persiste como activity genérica', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const created = await repository.create(auth, 'obligations', {
    name: 'DCTFWeb',
    frequency: 'mensal',
    category: 'federal',
    day_of_month: 15,
    module_key: 'fiscal',
    requires_attachment: true,
  });

  assert.equal(created.name, 'DCTFWeb');
  assert.equal(created.frequency, 'mensal');
  assert.ok(created.id);
  assert.equal(created.record_type, undefined);
  assert.equal(created.module_id, undefined);
  assert.equal(created.provenance, undefined);

  const [stored] = findBySk(client, 'RECORD#obrigacoes#activity#');
  assert.equal(stored.PK, 'WORKSPACE#empresa-a');
  assert.equal(stored.record_type, 'activity');
  assert.equal(stored.name, 'DCTFWeb');
  assert.equal(stored.provenance.origin, 'painel-obrigacoes');
  assert.equal(stored.provenance.actor_id, 'user-a');
});

test('occurrence mantém unicidade por atividade e data e cria evidence metadata no DynamoDB', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);
  const activity = await repository.create(auth, 'obligations', {
    name: 'EFD',
    frequency: 'mensal',
  });

  const occurrence = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-09-30',
    done_by: 'user-a',
    done_by_name: 'Usuário A',
    attachment_path: 'painel-obrigacoes/staging/empresa-a/obligations/x/file.pdf',
    checklist_total: 2,
    checklist_checked: 2,
  });

  assert.equal(occurrence.obligation_id, activity.id);
  assert.equal(occurrence.occurrence_date, '2026-09-30');
  assert.equal(occurrence.attachment_path, 'painel-obrigacoes/staging/empresa-a/obligations/x/file.pdf');

  const occurrences = findBySk(client, 'RECORD#obrigacoes#occurrence#');
  const evidences = findBySk(client, 'RECORD#obrigacoes#evidence#');
  assert.equal(occurrences.length, 1);
  assert.equal(evidences.length, 1);
  assert.equal(evidences[0].attachment_path, occurrence.attachment_path);
  assert.equal(evidences[0].storage_provider, 's3');
  assert.equal(evidences[0].occurrence_id, occurrence.id);

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: activity.id,
      occurrence_date: '2026-09-30',
      done_by: 'user-a',
      attachment_path: 'painel-obrigacoes/staging/empresa-a/obligations/x/file.pdf',
    }),
    (error) => error.statusCode === 409,
  );
});

test('todos os papéis operacionais podem concluir atividade com grant de obrigações', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create({
    ...auth,
    userId: 'setup-admin',
    role: 'admin',
  }, 'obligations', {
    name: 'Fechamento mensal',
    frequency: 'mensal',
    competence_offset_months: 0,
    requires_attachment: false,
  });

  const roles = ['member', 'manager', 'admin', 'super_admin'];
  for (const [index, role] of roles.entries()) {
    const actor = {
      ...auth,
      userId: `user-${role}`,
      email: `${role}@empresa.test`,
      role,
      moduleGrants: ['obrigacoes'],
    };
    const day = String(index + 20).padStart(2, '0');
    const completion = await repository.create(actor, 'completions', {
      obligation_id: activity.id,
      occurrence_date: `2026-09-${day}`,
      done_by: actor.userId,
      done_by_name: role,
      checklist_total: 0,
      checklist_checked: 0,
    });

    assert.equal(completion.done_by, actor.userId);
    assert.equal(completion.occurrence_date, `2026-09-${day}`);
    assert.equal(completion.obligation_snapshot.name, 'Fechamento mensal');
  }

  assert.equal(findBySk(client, 'RECORD#obrigacoes#occurrence#').length, roles.length);
});

test('checklist-item nasce desmarcado e continua editável pelo endpoint legado', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);
  const activity = await repository.create(auth, 'obligations', {
    name: 'Fechamento',
    frequency: 'mensal',
  });

  const item = await repository.create(auth, 'checklist_items', {
    obligation_id: activity.id,
    description: 'Conferir notas',
    position: 0,
  });

  assert.equal(item.done, false);
  assert.equal(item.completed_at, null);

  const updated = await repository.update(auth, 'checklist_items', item.id, {
    done: true,
    completed_at: '2026-09-18T15:00:00.000Z',
    version: item.version,
  });

  assert.equal(updated.done, true);
  assert.equal(updated.completed_at, '2026-09-18T15:00:00.000Z');
  assert.equal(updated.description, 'Conferir notas');
});

test('occurrence e checklist não podem apontar para activity de outro workspace', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);
  await seedActiveEntitlement(repository, 'empresa-b');

  const otherAuth = { ...auth, workspaceId: 'empresa-b' };
  const otherActivity = await repository.create(otherAuth, 'obligations', {
    name: 'Outra empresa',
    frequency: 'mensal',
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: otherActivity.id,
      occurrence_date: '2026-09-30',
    }),
    (error) => error.statusCode === 404,
  );

  await assert.rejects(
    repository.create(auth, 'checklist_items', {
      obligation_id: otherActivity.id,
      description: 'Não pode',
      position: 0,
    }),
    (error) => error.statusCode === 404,
  );
});

test('list retorna os mesmos campos usados pelo frontend, sem metadados internos', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);
  await repository.create(auth, 'obligations', {
    name: 'DIRF',
    frequency: 'anual',
    month: 2,
    day_of_month: 28,
  });

  const page = await repository.list(auth, 'obligations');

  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].name, 'DIRF');
  assert.equal(page.items[0].frequency, 'anual');
  assert.equal(page.items[0].record_type, undefined);
  assert.equal(page.items[0].provenance, undefined);
});

test('excluir activity remove occurrence, checklist-item e evidence do mesmo workspace', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);
  const activity = await repository.create(auth, 'obligations', {
    name: 'Apuração',
    frequency: 'mensal',
  });

  const deletionChecklist = await repository.create(auth, 'checklist_items', {
    obligation_id: activity.id,
    description: 'Passo 1',
    position: 0,
  });
  await repository.update(auth, 'checklist_items', deletionChecklist.id, {
    done: true,
    completed_at: '2026-09-30T10:00:00.000Z',
    version: deletionChecklist.version,
  });

  await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-09-30',
    attachment_path: 'painel-obrigacoes/staging/empresa-a/obligations/x/evidence.pdf',
  });

  await repository.remove(auth, 'obligations', activity.id);

  assert.equal(findBySk(client, 'RECORD#obrigacoes#activity#').length, 0);
  assert.equal(findBySk(client, 'RECORD#obrigacoes#occurrence#').length, 0);
  assert.equal(findBySk(client, 'RECORD#obrigacoes#checklist-item#').length, 0);
  assert.equal(findBySk(client, 'RECORD#obrigacoes#evidence#').length, 0);
});

test('backend bloqueia conclusão sem comprovante obrigatório e checklist pendente', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const attachmentActivity = await repository.create(auth, 'obligations', {
    name: 'Com comprovante',
    frequency: 'mensal',
    requires_attachment: true,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: attachmentActivity.id,
      occurrence_date: '2026-09-25',
      done_by: auth.userId,
    }),
    (error) => error.statusCode === 400 && /Comprovante obrigatório/i.test(error.message),
  );

  const checklistActivity = await repository.create(auth, 'obligations', {
    name: 'Com checklist',
    frequency: 'mensal',
    requires_attachment: false,
  });
  await repository.create(auth, 'checklist_items', {
    obligation_id: checklistActivity.id,
    description: 'Conferir dados',
    position: 0,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: checklistActivity.id,
      occurrence_date: '2026-09-26',
      done_by: auth.userId,
    }),
    (error) => error.statusCode === 400 && /Checklist incompleto/i.test(error.message),
  );
});

test('backend aplica ciclo de validação e restringe aprovação ao validador designado', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create(auth, 'obligations', {
    name: 'Atividade validada',
    frequency: 'mensal',
    requires_attachment: false,
    requires_validation: true,
    validator_id: 'validator-a',
  });

  const completion = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-09-27',
    done_by: auth.userId,
    done_by_name: 'Executor',
  });

  assert.equal(completion.status, 'aguardando_validacao');
  assert.equal(completion.validator_id, 'validator-a');
  assert.equal(completion.done_by, auth.userId);

  await assert.rejects(
    repository.update(auth, 'completions', completion.id, {
      status: 'validada',
      version: completion.version,
    }),
    (error) => error.statusCode === 403 && /validador designado/i.test(error.message),
  );

  const validator = {
    ...auth,
    userId: 'validator-a',
    email: 'validator@empresa.test',
    role: 'member',
  };
  const approved = await repository.update(validator, 'completions', completion.id, {
    status: 'validada',
    version: completion.version,
  });

  assert.equal(approved.status, 'validada');
  assert.equal(approved.validated_by, 'validator-a');
  assert.ok(approved.validated_at);
});

test('executor não pode concluir quando ele próprio é o validador obrigatório', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create(auth, 'obligations', {
    name: 'Segregação de função',
    frequency: 'mensal',
    requires_attachment: false,
    requires_validation: true,
    validator_id: auth.userId,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: activity.id,
      occurrence_date: '2026-09-28',
      done_by: auth.userId,
    }),
    (error) => error.statusCode === 400 && /não pode validar o próprio trabalho/i.test(error.message),
  );
});

test('admin sem entitlement do módulo recebe 403', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  const admin = {
    ...auth,
    role: 'admin',
    moduleGrants: ['obrigacoes'],
  };

  await assert.rejects(
    repository.create(admin, 'obligations', {
      name: 'Bloqueada',
      frequency: 'mensal',
    }),
    (error) => error.statusCode === 403,
  );

  assert.equal(findBySk(client, 'RECORD#obrigacoes#activity#').length, 0);
});

test('usuário comum com entitlement ativo opera dentro do papel permitido', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const created = await repository.create(auth, 'obligations', {
    name: 'Permitida',
    frequency: 'mensal',
  });

  assert.equal(created.name, 'Permitida');
  assert.equal(findBySk(client, 'RECORD#obrigacoes#activity#').length, 1);
});


test('conclusão congela competência e estrutura e alterações futuras preservam o histórico', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create(auth, 'obligations', {
    name: 'DCTFWeb',
    frequency: 'mensal',
    competence_offset_months: 1,
    module_key: 'fiscal',
    requires_attachment: false,
  });

  const completion = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-09-20',
    done_by: 'user-a',
    done_by_name: 'Usuário A',
  });

  assert.equal(completion.competence_date, '2026-08-01');
  assert.equal(completion.obligation_snapshot.name, 'DCTFWeb');
  assert.equal(completion.obligation_snapshot.competence_offset_months, 1);

  const updated = await repository.update(auth, 'obligations', activity.id, {
    competence_offset_months: 0,
    version: activity.version,
  });

  assert.equal(updated.competence_offset_months, 0);
  assert.equal(updated.structure_history.length, 1);
  assert.equal(updated.structure_history[0].snapshot.competence_offset_months, 1);
  assert.equal(updated.structure_history[0].snapshot.name, 'DCTFWeb');

  const preserved = await repository.get(auth, 'completions', completion.id);
  assert.equal(preserved.competence_date, '2026-08-01');
  assert.equal(preserved.obligation_snapshot.competence_offset_months, 1);
});

test('update de conclusão não permite reescrever snapshot histórico', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create(auth, 'obligations', {
    name: 'EFD-Reinf',
    frequency: 'mensal',
    competence_offset_months: 1,
    requires_attachment: false,
  });
  const completion = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-09-15',
  });

  const updated = await repository.update(auth, 'completions', completion.id, {
    competence_date: '2026-09-01',
    obligation_snapshot: { name: 'adulterado', competence_offset_months: 0 },
    version: completion.version,
  });

  assert.equal(updated.competence_date, '2026-08-01');
  assert.equal(updated.obligation_snapshot.name, 'EFD-Reinf');
  assert.equal(updated.obligation_snapshot.competence_offset_months, 1);
});
