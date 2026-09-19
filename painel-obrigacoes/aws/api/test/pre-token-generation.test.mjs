import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPreTokenClaims,
  buildPreTokenClaims,
  resolveMemberForToken,
} from '../src/pre-token-generation.mjs';

function eventFor(workspaceId) {
  return {
    userName: 'cognito-user',
    request: {
      userAttributes: {
        sub: 'sub-1',
        'custom:legacy_user_id': 'user-1',
        ...(workspaceId ? { 'custom:active_workspace_id': workspaceId } : {}),
      },
    },
    response: {},
  };
}

test('Pre Token Generation lê MEMBER selecionado e injeta workspace, role e grants', async () => {
  let getInput;
  const client = {
    send: async (command) => {
      getInput = command.input;
      return {
        Item: {
          PK: 'WORKSPACE#workspace-b',
          SK: 'MEMBER#user-1',
          GSI1PK: 'MEMBER#user-1',
          GSI1SK: 'WORKSPACE#workspace-b',
          workspaceId: 'workspace-b',
          userId: 'user-1',
          entityType: 'member',
          active: true,
          role: 'manager',
          module_grants: ['obrigacoes', 'relatorios'],
        },
      };
    },
  };

  const event = eventFor('workspace-b');
  const claims = await buildPreTokenClaims(event, client, 'table');

  assert.deepEqual(getInput.Key, {
    PK: 'WORKSPACE#workspace-b',
    SK: 'MEMBER#user-1',
  });
  assert.equal(getInput.ConsistentRead, true);
  assert.deepEqual(claims, {
    'custom:workspace_id': 'workspace-b',
    'custom:role': 'manager',
    'custom:module_grants': JSON.stringify(['obrigacoes', 'relatorios']),
  });

  const output = applyPreTokenClaims(event, claims);
  assert.equal(
    output.response.claimsOverrideDetails.claimsToAddOrOverride['custom:workspace_id'],
    'workspace-b',
  );
  assert.equal(
    output.response.claimsOverrideDetails.claimsToAddOrOverride['custom:role'],
    'manager',
  );
  assert.ok(
    output.response.claimsOverrideDetails.claimsToSuppress.includes('custom:active_workspace_id'),
  );
});

test('sem seletor Cognito aceita fallback somente quando existe um único MEMBER ativo', async () => {
  const client = {
    send: async (command) => {
      assert.equal(command.constructor.name, 'QueryCommand');
      return {
        Items: [{
          PK: 'WORKSPACE#workspace-a',
          SK: 'MEMBER#user-1',
          GSI1PK: 'MEMBER#user-1',
          GSI1SK: 'WORKSPACE#workspace-a',
          workspaceId: 'workspace-a',
          userId: 'user-1',
          entityType: 'member',
          active: true,
          role: 'member',
        }],
      };
    },
  };

  const member = await resolveMemberForToken(eventFor(), client, 'table');
  assert.equal(member.workspaceId, 'workspace-a');
});

test('MEMBER inativo não emite claims para o token', async () => {
  const client = {
    send: async () => ({
      Item: {
        PK: 'WORKSPACE#workspace-b',
        SK: 'MEMBER#user-1',
        workspaceId: 'workspace-b',
        userId: 'user-1',
        entityType: 'member',
        active: false,
        role: 'member',
      },
    }),
  };

  await assert.rejects(
    buildPreTokenClaims(eventFor('workspace-b'), client, 'table'),
    /sem MEMBER ativo/i,
  );
});
