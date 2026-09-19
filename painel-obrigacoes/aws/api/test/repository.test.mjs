import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/repository.mjs';

const auth = { workspaceId: 'empresa-a', userId: 'user-a', role: 'member', email: 'user@empresa.test' };

test('listagem limita a página e devolve cursor opaco', async () => {
  const calls = [];
  const client = { send: async (command) => {
    calls.push(command.input);
    return {
      Items: [{ PK: 'private', SK: 'private', id: '1', name: 'Obrigacao' }],
      LastEvaluatedKey: { PK: 'tenant', SK: 'OBLIGATION#1' }
    };
  } };
  const repository = new Repository(client, 'table');
  const page = await repository.list(auth, 'obligations', { limit: 500 });
  assert.equal(calls[0].Limit, 100);
  assert.deepEqual(page.items, [{ id: '1', name: 'Obrigacao' }]);
  assert.ok(page.cursor);
});

test('listagem rejeita cursor adulterado', async () => {
  const repository = new Repository({ send: async () => ({}) }, 'table');
  await assert.rejects(
    repository.list(auth, 'obligations', { cursor: 'nao-e-um-cursor' }),
    /Cursor inválido/
  );
});

test('atualização de perfil sincroniza role e grants no MEMBER existente', async () => {
  const admin = {
    workspaceId: 'empresa-a',
    userId: 'admin-a',
    role: 'admin',
    email: 'admin@empresa.test',
    moduleGrants: ['administracao'],
  };
  let transaction;
  const client = {
    send: async (command) => {
      if (command.constructor.name === 'GetCommand') {
        return {
          Item: {
            PK: 'TOOL#painel-obrigacoes#ENV#dev#WORKSPACE#empresa-a',
            SK: 'PROFILE#user-b',
            id: 'user-b',
            workspace_id: 'empresa-a',
            entityType: 'profiles',
            role: 'membro',
            active: true,
            version: 1,
          },
        };
      }
      transaction = command.input;
      return {};
    },
  };

  const repository = new Repository(client, 'table');
  await repository.update(admin, 'profiles', 'user-b', {
    role: 'gestor',
    active: true,
    module_access: ['obrigacoes'],
    version: 1,
  });

  const memberUpdate = transaction.TransactItems[1].Update;
  assert.deepEqual(memberUpdate.Key, {
    PK: 'WORKSPACE#empresa-a',
    SK: 'MEMBER#user-b',
  });
  assert.equal(memberUpdate.ExpressionAttributeValues[':role'], 'manager');
  assert.deepEqual(memberUpdate.ExpressionAttributeValues[':moduleGrants'], ['obrigacoes']);
  assert.match(memberUpdate.ConditionExpression, /attribute_exists/);
});
