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

test('atualização de perfil sincroniza papel sem misturar module_access com grants de segurança', async () => {
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
    module_access: ['fiscal'],
    version: 1,
  });

  const memberUpdate = transaction.TransactItems[1].Update;
  assert.deepEqual(memberUpdate.Key, {
    PK: 'WORKSPACE#empresa-a',
    SK: 'MEMBER#user-b',
  });
  assert.equal(memberUpdate.ExpressionAttributeValues[':role'], 'manager');
  assert.equal(memberUpdate.ExpressionAttributeValues[':moduleGrants'], undefined);
  assert.doesNotMatch(memberUpdate.UpdateExpression, /module_grants/);
  assert.match(memberUpdate.ConditionExpression, /attribute_exists/);
});

test('delegado com grant administracao pode ajustar module_access, mas não papel ou active', async () => {
  const delegated = {
    workspaceId: 'empresa-a',
    userId: 'gestor-a',
    role: 'manager',
    email: 'gestor@empresa.test',
    moduleGrants: ['obrigacoes', 'administracao'],
  };
  const current = {
    PK: 'TOOL#painel-obrigacoes#ENV#dev#WORKSPACE#empresa-a',
    SK: 'PROFILE#user-b',
    id: 'user-b',
    workspace_id: 'empresa-a',
    entityType: 'profiles',
    role: 'membro',
    active: true,
    module_access: [],
    version: 1,
  };
  const client = {
    send: async (command) => {
      if (command.constructor.name === 'GetCommand') return { Item: current };
      return {};
    },
  };
  const repository = new Repository(client, 'table');

  await assert.doesNotReject(
    repository.update(delegated, 'profiles', 'user-b', { module_access: ['fiscal'], version: 1 }),
  );
  await assert.rejects(
    repository.update(delegated, 'profiles', 'user-b', { role: 'gestor', version: 1 }),
    /Admin da Ferramenta|papéis|delegação administrativa|alterar papel/i,
  );
  await assert.rejects(
    repository.update(delegated, 'profiles', 'user-b', { active: false, version: 1 }),
    /Admin da Ferramenta|controle de acesso/i,
  );
});


test('membro com grant de obrigações pode ler dados auxiliares, mas não administrar perfis', async () => {
  const member = {
    workspaceId: 'empresa-a',
    userId: 'user-a',
    role: 'member',
    email: 'user@empresa.test',
    moduleGrants: ['obrigacoes'],
  };
  const client = {
    send: async (command) => {
      if (command.constructor.name === 'QueryCommand') {
        return { Items: [], LastEvaluatedKey: undefined };
      }
      if (command.constructor.name === 'GetCommand') {
        return {
          Item: {
            PK: 'TOOL#painel-obrigacoes#ENV#dev#WORKSPACE#empresa-a',
            SK: 'PROFILE#user-b',
            id: 'user-b',
            role: 'membro',
            active: true,
            version: 1,
          },
        };
      }
      return {};
    },
  };
  const repository = new Repository(client, 'table');

  await assert.doesNotReject(repository.list(member, 'profiles'));
  await assert.rejects(
    repository.update(member, 'profiles', 'user-b', { display_name: 'Novo nome', version: 1 }),
    /Módulo não concedido/,
  );
});
