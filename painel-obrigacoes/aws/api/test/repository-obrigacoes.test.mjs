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
      done_by: 'user-b',
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
  }

  assert.equal(findBySk(client, 'RECORD#obrigacoes#occurrence#').length, roles.length);
});

test('validação orienta membro/gestor e não bloqueia admin da ferramenta', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create({ ...auth, role: 'admin', userId: 'setup-admin' }, 'obligations', {
    name: 'Entrega com validação',
    frequency: 'mensal',
    requires_validation: true,
    validator_id: 'validator-user',
  });

  for (const role of ['member', 'manager']) {
    const actor = { ...auth, role, userId: 'executor-' + role };
    const completion = await repository.create(actor, 'completions', {
      obligation_id: activity.id,
      occurrence_date: role === 'member' ? '2026-10-10' : '2026-10-11',
      done_by: actor.userId,
      done_by_name: role,
    });
    assert.equal(completion.status, 'aguardando_validacao');
    assert.equal(completion.validator_id, 'validator-user');
    assert.ok(completion.submitted_at);
  }

  for (const role of ['admin', 'super_admin']) {
    const actor = { ...auth, role, userId: 'executor-' + role };
    const completion = await repository.create(actor, 'completions', {
      obligation_id: activity.id,
      occurrence_date: role === 'admin' ? '2026-10-12' : '2026-10-13',
      done_by: actor.userId,
      done_by_name: role,
    });
    assert.equal(completion.status, 'validada');
    assert.equal(completion.validated_by, actor.userId);
  }
});

test('conclusão explica validador ausente ou igual ao executor', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const missing = await repository.create({ ...auth, role: 'admin', userId: 'setup-admin' }, 'obligations', {
    name: 'Sem validador',
    frequency: 'mensal',
    requires_validation: true,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: missing.id,
      occurrence_date: '2026-10-20',
      done_by: auth.userId,
    }),
    (error) => error.statusCode === 422 && /definir um validador/i.test(error.message),
  );

  const same = await repository.create({ ...auth, role: 'admin', userId: 'setup-admin' }, 'obligations', {
    name: 'Validador igual',
    frequency: 'mensal',
    requires_validation: true,
    validator_id: auth.userId,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: same.id,
      occurrence_date: '2026-10-21',
      done_by: auth.userId,
    }),
    (error) => error.statusCode === 422 && /próprio validador/i.test(error.message),
  );
});

test('comprovante obrigatório bloqueia com mensagem clara e sem movimento respeita exceção', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create({ ...auth, role: 'admin', userId: 'setup-admin' }, 'obligations', {
    name: 'Entrega documental',
    frequency: 'mensal',
    requires_attachment: true,
    requires_attachment_no_movement: false,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: activity.id,
      occurrence_date: '2026-10-22',
      movement_status: 'com_movimento',
    }),
    (error) => error.statusCode === 422 && /Comprovante obrigatório/i.test(error.message),
  );

  const noMovement = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-10-23',
    movement_status: 'sem_movimento',
  });
  assert.equal(noMovement.movement_status, 'sem_movimento');
});

test('checklist persistido precisa estar completo antes da conclusão', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
  await seedActiveEntitlement(repository);

  const activity = await repository.create({ ...auth, role: 'admin', userId: 'setup-admin' }, 'obligations', {
    name: 'Entrega com checklist',
    frequency: 'mensal',
  });
  const item = await repository.create(auth, 'checklist_items', {
    obligation_id: activity.id,
    description: 'Conferir base',
    position: 0,
  });

  await assert.rejects(
    repository.create(auth, 'completions', {
      obligation_id: activity.id,
      occurrence_date: '2026-10-24',
    }),
    (error) => error.statusCode === 422 && /Checklist incompleto/i.test(error.message),
  );

  await repository.update(auth, 'checklist_items', item.id, {
    done: true,
    completed_at: '2026-10-24T12:00:00.000Z',
    version: item.version,
  });

  const completion = await repository.create(auth, 'completions', {
    obligation_id: activity.id,
    occurrence_date: '2026-10-24',
  });
  assert.equal(completion.status, 'validada');
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

  await repository.create(auth, 'checklist_items', {
    obligation_id: activity.id,
    description: 'Passo 1',
    position: 0,
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
