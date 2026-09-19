import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePortalIdentity } from '../src/portal-identity.mjs';

test('reconcilia userId do Portal com custom:legacy_user_id do Cognito', async () => {
  const cognito = {
    send: async () => ({
      UserAttributes: [
        { Name: 'email', Value: 'pessoa@example.com' },
        { Name: 'custom:legacy_user_id', Value: 'legacy-user-1' },
      ],
    }),
  };

  const documentClient = {
    send: async (command) => {
      if (command.constructor.name === 'GetCommand') return {};
      if (command.constructor.name === 'QueryCommand') return { Items: [] };
      return {};
    },
  };

  const resolved = await resolvePortalIdentity(
    cognito,
    documentClient,
    'table',
    'pool-1',
    {
      userId: 'portal-user-new',
      workspaceId: 'workspace-1',
      email: 'Pessoa@Example.com',
      displayName: 'Pessoa',
      workspaceName: 'Empresa',
      document: '',
    },
  );

  assert.equal(resolved.userId, 'legacy-user-1');
  assert.equal(resolved.workspaceId, 'workspace-1');
  assert.equal(resolved.email, 'pessoa@example.com');
});

test('preserva vínculo genérico ativo do workspace solicitado', async () => {
  const cognito = {
    send: async () => ({
      UserAttributes: [
        { Name: 'custom:legacy_user_id', Value: 'legacy-user-1' },
      ],
    }),
  };

  let queriedGsi = false;
  const documentClient = {
    send: async (command) => {
      if (command.constructor.name === 'GetCommand') {
        return {
          Item: {
            PK: 'WORKSPACE#workspace-1',
            SK: 'MEMBER#legacy-user-1',
            entityType: 'member',
            active: true,
            workspaceId: 'workspace-1',
            userId: 'legacy-user-1',
          },
        };
      }
      if (command.constructor.name === 'QueryCommand') {
        queriedGsi = true;
        return { Items: [] };
      }
      return {};
    },
  };

  const resolved = await resolvePortalIdentity(
    cognito,
    documentClient,
    'table',
    'pool-1',
    {
      userId: 'portal-user-new',
      workspaceId: 'workspace-1',
      email: 'pessoa@example.com',
      displayName: 'Pessoa',
      workspaceName: 'Empresa',
      document: '12.345.678/0001-90',
    },
  );

  assert.equal(resolved.userId, 'legacy-user-1');
  assert.equal(resolved.workspaceId, 'workspace-1');
  assert.equal(queriedGsi, false);
});

test('usuário ainda inexistente no Cognito mantém a identidade recebida do Portal', async () => {
  const cognito = {
    send: async () => {
      const error = new Error('not found');
      error.name = 'UserNotFoundException';
      throw error;
    },
  };
  const documentClient = {
    send: async () => assert.fail('não deve consultar DynamoDB'),
  };

  const input = {
    userId: 'portal-user-1',
    workspaceId: 'workspace-1',
    email: 'Pessoa@Example.com',
    displayName: 'Pessoa',
    workspaceName: 'Empresa',
    document: '',
  };

  const resolved = await resolvePortalIdentity(
    cognito,
    documentClient,
    'table',
    'pool-1',
    input,
  );

  assert.equal(resolved.userId, input.userId);
  assert.equal(resolved.workspaceId, input.workspaceId);
  assert.equal(resolved.email, 'pessoa@example.com');
});
