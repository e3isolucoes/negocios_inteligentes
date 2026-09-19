import assert from 'node:assert/strict';
import test from 'node:test';
import { suspendExpiredEntitlements } from '../src/entitlements.mjs';

test('job suspende entitlement ativo vencido sem remover dados', async () => {
  const updates = [];
  let scanCount = 0;
  const client = {
    send: async (command) => {
      const name = command.constructor.name;
      if (name === 'ScanCommand') {
        scanCount += 1;
        return {
          Items: [{
            PK: 'WORKSPACE#empresa-a',
            SK: 'ENTITLEMENT#obrigacoes',
            status: 'ativo',
            renewsAt: '2026-09-18T00:00:00.000Z',
          }],
        };
      }
      if (name === 'UpdateCommand') {
        updates.push(command.input);
        return {};
      }
      throw new Error(`Comando inesperado: ${name}`);
    },
  };

  const result = await suspendExpiredEntitlements(
    client,
    'table',
    new Date('2026-09-19T00:00:00.000Z'),
  );

  assert.equal(scanCount, 1);
  assert.equal(result.suspended, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].Key, {
    PK: 'WORKSPACE#empresa-a',
    SK: 'ENTITLEMENT#obrigacoes',
  });
  assert.match(updates[0].UpdateExpression, /#status = :suspended/);
  assert.equal(updates[0].ExpressionAttributeValues[':suspended'], 'suspenso');
  assert.equal(updates[0].ExpressionAttributeValues[':now'], '2026-09-19T00:00:00.000Z');
});

test('job tolera renovação concorrente e não sobrescreve contrato já atualizado', async () => {
  const conditional = new Error('renovado');
  conditional.name = 'ConditionalCheckFailedException';

  const client = {
    send: async (command) => {
      const name = command.constructor.name;
      if (name === 'ScanCommand') {
        return {
          Items: [{
            PK: 'WORKSPACE#empresa-a',
            SK: 'ENTITLEMENT#obrigacoes',
            status: 'ativo',
            renewsAt: '2026-09-18T00:00:00.000Z',
          }],
        };
      }
      if (name === 'UpdateCommand') throw conditional;
      throw new Error(`Comando inesperado: ${name}`);
    },
  };

  const result = await suspendExpiredEntitlements(
    client,
    'table',
    new Date('2026-09-19T00:00:00.000Z'),
  );

  assert.equal(result.suspended, 0);
});
