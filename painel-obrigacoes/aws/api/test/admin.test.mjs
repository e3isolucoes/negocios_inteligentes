import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminService } from '../src/admin.mjs';

const profile = {
  PK: 'TOOL#painel-obrigacoes#ENV#dev#WORKSPACE#empresa-a',
  SK: 'PROFILE#user-b',
  id: 'user-b',
  workspace_id: 'empresa-a',
  email: 'user-b@empresa.test',
  display_name: 'Usuário B',
  role: 'membro',
  active: true,
  module_access: ['fiscal'],
  module_grants: ['obrigacoes'],
  version: 1,
  entityType: 'profiles',
};

const member = {
  PK: 'WORKSPACE#empresa-a',
  SK: 'MEMBER#user-b',
  GSI1PK: 'MEMBER#user-b',
  GSI1SK: 'WORKSPACE#empresa-a',
  userId: 'user-b',
  workspaceId: 'empresa-a',
  email: 'user-b@empresa.test',
  role: 'member',
  active: true,
  module_grants: ['obrigacoes'],
  entityType: 'member',
};

function membershipClient() {
  const transactions = [];
  return {
    transactions,
    send: async (command) => {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        if (command.input.Key.PK === 'WORKSPACE#empresa-a') return { Item: structuredClone(member) };
        if (String(command.input.Key.PK).includes('TOOL#painel-obrigacoes')) return { Item: structuredClone(profile) };
        return {};
      }
      if (name === 'TransactWriteCommand') {
        transactions.push(command.input);
        return {};
      }
      throw new Error('Comando inesperado no teste: ' + name);
    },
  };
}

test('delegado com administracao pode revogar membro, mas não alterar papel nem grants', async () => {
  const client = membershipClient();
  const service = new AdminService(client, { send: async () => ({}) }, 'table', 'pool');
  const delegated = {
    workspaceId: 'empresa-a',
    userId: 'gestor-a',
    role: 'manager',
    moduleGrants: ['obrigacoes', 'administracao'],
  };

  const updated = await service.setMembership(delegated, 'user-b', 'empresa-a', { active: false });
  assert.equal(updated.active, false);
  assert.equal(updated.role, 'membro');

  await assert.rejects(
    service.setMembership(delegated, 'user-b', 'empresa-a', { role: 'admin' }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    service.setMembership(delegated, 'user-b', 'empresa-a', { module_grants: ['obrigacoes', 'administracao'] }),
    (error) => error.statusCode === 403,
  );
});

test('Admin da Ferramenta concede administracao no MEMBER canônico e preserva obrigacoes', async () => {
  const client = membershipClient();
  const service = new AdminService(client, { send: async () => ({}) }, 'table', 'pool');
  const admin = {
    workspaceId: 'empresa-a',
    userId: 'admin-a',
    role: 'admin',
    moduleGrants: ['obrigacoes'],
  };

  const updated = await service.setMembership(admin, 'user-b', 'empresa-a', {
    module_grants: ['administracao'],
  });

  assert.deepEqual(updated.module_grants, ['administracao', 'obrigacoes']);
  const transaction = client.transactions.at(-1);
  const storedMember = transaction.TransactItems[0].Put.Item;
  assert.equal(storedMember.PK, 'WORKSPACE#empresa-a');
  assert.equal(storedMember.SK, 'MEMBER#user-b');
  assert.deepEqual(storedMember.module_grants, ['administracao', 'obrigacoes']);
});

test('convite AWS cria MEMBER canônico com grant operacional obrigatório', async () => {
  const transactions = [];
  const client = {
    send: async (command) => {
      if (command.constructor.name === 'TransactWriteCommand') {
        transactions.push(command.input);
        return {};
      }
      throw new Error('Comando inesperado no teste: ' + command.constructor.name);
    },
  };
  const cognito = { send: async () => ({}) };
  const service = new AdminService(client, cognito, 'table', 'pool');
  const admin = {
    workspaceId: 'empresa-a',
    userId: 'admin-a',
    role: 'admin',
    moduleGrants: ['obrigacoes'],
  };

  const created = await service.inviteUser(admin, {
    email: 'nova@empresa.test',
    displayName: 'Nova Pessoa',
    role: 'membro',
  });

  assert.equal(created.profile.role, 'membro');
  const memberItem = transactions[0].TransactItems[0].Put.Item;
  assert.equal(memberItem.PK, 'WORKSPACE#empresa-a');
  assert.match(memberItem.SK, /^MEMBER#/);
  assert.equal(memberItem.role, 'member');
  assert.deepEqual(memberItem.module_grants, ['obrigacoes']);
});
