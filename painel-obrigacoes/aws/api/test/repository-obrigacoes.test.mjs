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

test('obligations mantém contrato HTTP legado e persiste como activity genérica', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');

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

test('checklist-item nasce desmarcado e continua editável pelo endpoint legado', async () => {
  const client = new MemoryDocumentClient();
  const repository = new ObrigacoesRepository(client, 'table');
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
