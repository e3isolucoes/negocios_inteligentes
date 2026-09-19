import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUEDATE_INDEX,
  GenericRepository,
  RECORD_LOOKUP_INDEX,
  getRecord,
  listEventsSince,
  listRelationsOfRecord,
  putEvent,
  putRecord,
  putRelation,
  queryRecordsByModule,
} from '../src/repository-generic.mjs';

function clientFrom(handler, { activeModules = ['obrigacoes', 'crm'] } = {}) {
  return {
    send: async (command) => {
      const key = command.input?.Key;
      if (command.constructor.name === 'GetCommand' && key?.SK?.startsWith('ENTITLEMENT#')) {
        const moduleId = key.SK.slice('ENTITLEMENT#'.length);
        if (!activeModules.includes(moduleId)) return {};
        const workspaceId = key.PK.slice('WORKSPACE#'.length);
        return {
          Item: {
            PK: key.PK,
            SK: key.SK,
            workspace_id: workspaceId,
            entityType: 'entitlement',
            moduleId,
            plan: 'standard',
            status: 'ativo',
            startedAt: '2026-09-01T00:00:00.000Z',
            renewsAt: '2026-10-01T00:00:00.000Z',
          },
        };
      }
      return handler(command);
    },
  };
}

test('putRecord grava sempre na partição do workspace e prepara GSI de vencimento', async () => {
  let input;
  const repository = new GenericRepository(clientFrom(async (command) => {
    input = command.input;
    return {};
  }), 'table');

  const record = await repository.putRecord('empresa-a', {
    moduleId: 'obrigacoes',
    recordType: 'obligation',
    recordId: 'rec-1',
    dueDate: '2026-10-15',
    data: { title: 'Entrega fiscal' },
  });

  assert.equal(input.Item.PK, 'WORKSPACE#empresa-a');
  assert.equal(input.Item.SK, 'RECORD#obrigacoes#obligation#rec-1');
  assert.equal(input.Item.workspace_id, 'empresa-a');
  assert.equal(input.Item.GSIDueDatePK, 'WORKSPACE#empresa-a#DUEDATE');
  assert.equal(input.Item.GSIDueDateSK, '2026-10-15#rec-1');
  assert.equal(record.title, 'Entrega fiscal');
  assert.equal(record.workspace_id, 'empresa-a');
});

test('queryRecordsByModule usa a partição do workspace e nunca devolve item de outro workspace', async () => {
  let query;
  const repository = new GenericRepository(clientFrom(async (command) => {
    query = command.input;
    return {
      Items: [
        {
          PK: 'WORKSPACE#empresa-a',
          SK: 'RECORD#crm#lead#same-id',
          workspace_id: 'empresa-a',
          record_id: 'same-id',
          module_id: 'crm',
          record_type: 'lead',
        },
        {
          PK: 'WORKSPACE#empresa-b',
          SK: 'RECORD#crm#lead#same-id',
          workspace_id: 'empresa-b',
          record_id: 'same-id',
          module_id: 'crm',
          record_type: 'lead',
        },
      ],
    };
  }), 'table');

  const result = await repository.queryRecordsByModule('empresa-a', 'crm');

  assert.equal(query.ExpressionAttributeValues[':pk'], 'WORKSPACE#empresa-a');
  assert.equal(query.ExpressionAttributeValues[':prefix'], 'RECORD#crm#');
  assert.deepEqual(result.items.map((item) => item.workspace_id), ['empresa-a']);
});

test('putRelation rejeita vínculo quando qualquer RECORD não pertence ao workspace solicitado', async () => {
  let call = 0;
  const repository = new GenericRepository(clientFrom(async () => {
    call += 1;
    if (call === 1) {
      return {
        Item: {
          PK: 'WORKSPACE#empresa-a',
          SK: 'RECORD#crm#lead#r1',
          workspace_id: 'empresa-a',
        },
      };
    }
    return {
      Item: {
        PK: 'WORKSPACE#empresa-b',
        SK: 'RECORD#crm#lead#r2',
        workspace_id: 'empresa-b',
      },
    };
  }), 'table');

  await assert.rejects(
    repository.putRelation('empresa-a', {
      recordModuleId: 'crm',
      recordType: 'lead',
      recordId: 'r1',
      relatedModuleId: 'crm',
      relatedRecordType: 'lead',
      relatedRecordId: 'r2',
    }),
    /mesmo workspace/,
  );
});

test('putRelation cria adjacência nos dois sentidos dentro da mesma partição', async () => {
  const calls = [];
  const repository = new GenericRepository(clientFrom(async (command) => {
    calls.push(command.input);
    if (calls.length <= 2) {
      const recordId = calls.length === 1 ? 'r1' : 'r2';
      return {
        Item: {
          PK: 'WORKSPACE#empresa-a',
          SK: `RECORD#crm#lead#${recordId}`,
          workspace_id: 'empresa-a',
        },
      };
    }
    return {};
  }), 'table');

  await repository.putRelation('empresa-a', {
    recordModuleId: 'crm',
    recordType: 'lead',
    recordId: 'r1',
    relatedModuleId: 'crm',
    relatedRecordType: 'lead',
    relatedRecordId: 'r2',
    relationType: 'depends-on',
  });

  const transaction = calls[2];
  assert.equal(transaction.TransactItems.length, 2);

  const forward = transaction.TransactItems[0].Put.Item;
  const reverse = transaction.TransactItems[1].Put.Item;

  assert.equal(forward.PK, 'WORKSPACE#empresa-a');
  assert.equal(forward.SK, 'RELATION#r1#r2');
  assert.equal(forward.GSIRecordPK, 'RECORD#r1');
  assert.equal(forward.GSIRecordSK, 'RELATION#r2');

  assert.equal(reverse.PK, 'WORKSPACE#empresa-a');
  assert.equal(reverse.SK, 'RELATION#r2#r1');
  assert.equal(reverse.GSIRecordPK, 'RECORD#r2');
  assert.equal(reverse.GSIRecordSK, 'RELATION#r1');
});

test('listRelationsOfRecord filtra outro workspace mesmo consultando RECORD#id diretamente na GSI', async () => {
  let query;
  const repository = new GenericRepository(clientFrom(async (command) => {
    query = command.input;
    return {
      Items: [
        {
          PK: 'WORKSPACE#empresa-a',
          SK: 'RELATION#same-id#related-a',
          workspace_id: 'empresa-a',
          GSIRecordPK: 'RECORD#same-id',
          GSIRecordSK: 'RELATION#related-a',
          record_module_id: 'crm',
          related_record_id: 'related-a',
        },
        {
          PK: 'WORKSPACE#empresa-b',
          SK: 'RELATION#same-id#related-b',
          workspace_id: 'empresa-b',
          GSIRecordPK: 'RECORD#same-id',
          GSIRecordSK: 'RELATION#related-b',
          record_module_id: 'crm',
          related_record_id: 'related-b',
        },
      ],
    };
  }), 'table');

  const result = await repository.listRelationsOfRecord('empresa-a', 'same-id', { moduleId: 'crm' });

  assert.equal(query.IndexName, RECORD_LOOKUP_INDEX);
  assert.equal(query.ExpressionAttributeValues[':recordPk'], 'RECORD#same-id');
  assert.equal(query.ExpressionAttributeValues[':workspaceId'], 'empresa-a');
  assert.equal(query.ExpressionAttributeValues[':workspacePk'], 'WORKSPACE#empresa-a');
  assert.match(query.FilterExpression, /workspace_id/);
  assert.deepEqual(result.items.map((item) => item.related_record_id), ['related-a']);
});

test('putEvent e listEventsSince permanecem na partição do workspace', async () => {
  const calls = [];
  const repository = new GenericRepository(clientFrom(async (command) => {
    calls.push(command.input);
    if (calls.length === 1) return {};
    return {
      Items: [
        {
          PK: 'WORKSPACE#empresa-a',
          SK: 'EVENT#2026-09-18T15:00:00.000Z#ev-1',
          workspace_id: 'empresa-a',
          event_id: 'ev-1',
        },
        {
          PK: 'WORKSPACE#empresa-b',
          SK: 'EVENT#2026-09-18T15:00:00.000Z#ev-2',
          workspace_id: 'empresa-b',
          event_id: 'ev-2',
        },
      ],
    };
  }), 'table');

  await repository.putEvent('empresa-a', {
    eventId: 'ev-1',
    eventType: 'record.created',
    timestamp: '2026-09-18T15:00:00Z',
  });

  const page = await repository.listEventsSince('empresa-a', '2026-09-18T00:00:00Z');

  assert.equal(calls[0].Item.PK, 'WORKSPACE#empresa-a');
  assert.equal(calls[0].Item.SK, 'EVENT#2026-09-18T15:00:00.000Z#ev-1');
  assert.equal(calls[1].ExpressionAttributeValues[':pk'], 'WORKSPACE#empresa-a');
  assert.deepEqual(page.items.map((item) => item.event_id), ['ev-1']);
});

test('constantes dos índices usam os nomes definidos pelo modelo da plataforma', () => {
  assert.equal(RECORD_LOOKUP_INDEX, 'GSI-RECORD-LOOKUP');
  assert.equal(DUEDATE_INDEX, 'GSI-DUEDATE');
});

test('payload do módulo não pode sobrescrever chaves internas nem injetar índices', async () => {
  let stored;
  const repository = new GenericRepository(clientFrom(async (command) => {
    stored = command.input.Item;
    return {};
  }), 'table');

  await repository.putRecord('empresa-a', {
    moduleId: 'crm',
    recordType: 'lead',
    recordId: 'safe-id',
    data: {
      PK: 'WORKSPACE#empresa-b',
      SK: 'RECORD#admin#secret#x',
      workspace_id: 'empresa-b',
      GSIRecordPK: 'RECORD#secret',
      GSIDueDatePK: 'WORKSPACE#empresa-b#DUEDATE',
      title: 'Lead legítimo',
    },
  });

  assert.equal(stored.PK, 'WORKSPACE#empresa-a');
  assert.equal(stored.SK, 'RECORD#crm#lead#safe-id');
  assert.equal(stored.workspace_id, 'empresa-a');
  assert.equal(stored.GSIRecordPK, undefined);
  assert.equal(stored.GSIDueDatePK, undefined);
  assert.equal(stored.title, 'Lead legítimo');
});

test('paginação da GSI nunca expõe chave de outro workspace no cursor', async () => {
  let call = 0;
  const repository = new GenericRepository(clientFrom(async () => {
    call += 1;
    if (call === 1) {
      return {
        Items: [],
        LastEvaluatedKey: {
          PK: 'WORKSPACE#empresa-b',
          SK: 'RELATION#same-id#foreign',
          GSIRecordPK: 'RECORD#same-id',
          GSIRecordSK: 'RELATION#foreign',
        },
      };
    }
    return {
      Items: [{
        PK: 'WORKSPACE#empresa-a',
        SK: 'RELATION#same-id#own',
        workspace_id: 'empresa-a',
        GSIRecordPK: 'RECORD#same-id',
        GSIRecordSK: 'RELATION#own',
        record_module_id: 'crm',
        related_record_id: 'own',
      }],
    };
  }), 'table');

  const result = await repository.listRelationsOfRecord('empresa-a', 'same-id', { moduleId: 'crm' });

  assert.deepEqual(result.items.map((item) => item.related_record_id), ['own']);
  assert.equal(result.cursor, null);
  assert.equal(call, 2);
});

test('operações públicas exigidas pelo contrato são exportadas como funções', () => {
  for (const operation of [
    putRecord,
    getRecord,
    queryRecordsByModule,
    putRelation,
    listRelationsOfRecord,
    putEvent,
    listEventsSince,
  ]) {
    assert.equal(typeof operation, 'function');
  }
});

test('RECORD é negado quando o workspace não possui entitlement ativo', async () => {
  const repository = new GenericRepository(
    clientFrom(async () => {
      throw new Error('não deveria acessar RECORD sem entitlement');
    }, { activeModules: [] }),
    'table',
  );

  await assert.rejects(
    repository.getRecord('empresa-a', 'obrigacoes', 'activity', 'a1'),
    (error) => error.statusCode === 403,
  );
});

test('entitlement genérico persiste contrato comercial no workspace', async () => {
  let stored;
  const repository = new GenericRepository({
    send: async (command) => {
      stored = command.input.Item;
      return {};
    },
  }, 'table');

  const entitlement = await repository.putEntitlement('empresa-a', {
    moduleId: 'obrigacoes',
    plan: 'standard',
    status: 'ativo',
    startedAt: '2026-09-01T00:00:00Z',
    renewsAt: '2026-10-01T00:00:00Z',
  });

  assert.equal(stored.PK, 'WORKSPACE#empresa-a');
  assert.equal(stored.SK, 'ENTITLEMENT#obrigacoes');
  assert.equal(entitlement.moduleId, 'obrigacoes');
  assert.equal(entitlement.plan, 'standard');
  assert.equal(entitlement.status, 'ativo');
});

test('GSI de relações não devolve mesmo recordId pertencente a outro módulo do workspace', async () => {
  const repository = new GenericRepository(clientFrom(async () => ({
    Items: [
      {
        PK: 'WORKSPACE#empresa-a',
        SK: 'RELATION#same-id#crm-related',
        workspace_id: 'empresa-a',
        record_module_id: 'crm',
        GSIRecordPK: 'RECORD#same-id',
        GSIRecordSK: 'RELATION#crm-related',
        related_record_id: 'crm-related',
      },
      {
        PK: 'WORKSPACE#empresa-a',
        SK: 'RELATION#same-id#fiscal-related',
        workspace_id: 'empresa-a',
        record_module_id: 'obrigacoes',
        GSIRecordPK: 'RECORD#same-id',
        GSIRecordSK: 'RELATION#fiscal-related',
        related_record_id: 'fiscal-related',
      },
    ],
  })), 'table');

  const result = await repository.listRelationsOfRecord(
    'empresa-a',
    'same-id',
    { moduleId: 'crm' },
  );

  assert.deepEqual(result.items.map((item) => item.related_record_id), ['crm-related']);
});
