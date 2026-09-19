import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePortalSession, createPortalSession } from '../src/portal-session.mjs';

test('consome uma sessão do portal uma única vez e rejeita reutilização', async () => {
  let item = { entityType: 'portal_session', toolId: 'painel-obrigacoes', environment: 'dev', expiresAt: 1_900_000_060, idToken: 'id', accessToken: 'access', refreshToken: 'refresh' };
  const client = { send: async () => { const Attributes = item; item = null; return { Attributes }; } };
  const code = 'A'.repeat(43);
  assert.deepEqual(await consumePortalSession(client, 'table', code, 1_900_000_000_000), { access_token: 'id', cognito_access_token: 'access', refresh_token: 'refresh' });
  await assert.rejects(() => consumePortalSession(client, 'table', code, 1_900_000_000_000), /inválido ou expirado/);
});

test('rejeita código malformado antes de consultar a tabela', async () => {
  const client = { send: async () => assert.fail('não deveria consultar') };
  await assert.rejects(() => consumePortalSession(client, 'table', 'curto'), /Código de acesso inválido/);
});

test('Portal grava active_workspace_id antes de emitir a sessão Cognito', async () => {
  const cognitoCalls = [];
  const cognito = {
    send: async (command) => {
      cognitoCalls.push(command);
      if (command.constructor.name === 'AdminGetUserCommand') {
        return {
          UserAttributes: [
            { Name: 'custom:legacy_user_id', Value: 'user-1' },
          ],
        };
      }
      if (command.constructor.name === 'AdminInitiateAuthCommand') {
        return {
          AuthenticationResult: {
            IdToken: 'id-token',
            AccessToken: 'access-token',
            RefreshToken: 'refresh-token',
          },
        };
      }
      return {};
    },
  };

  let storedSession;
  const documentClient = {
    send: async (command) => {
      if (command.constructor.name === 'PutCommand') {
        storedSession = command.input.Item;
      }
      return {};
    },
  };

  const result = await createPortalSession(
    cognito,
    documentClient,
    'table',
    { userPoolId: 'pool-1', clientId: 'client-1' },
    {
      userId: 'user-1',
      workspaceId: 'workspace-b',
      email: 'user@example.com',
      displayName: 'Usuário Teste',
    },
    1_900_000_000_000,
  );

  const update = cognitoCalls.find(
    (command) => command.constructor.name === 'AdminUpdateUserAttributesCommand',
  );
  const authenticateIndex = cognitoCalls.findIndex(
    (command) => command.constructor.name === 'AdminInitiateAuthCommand',
  );
  const updateIndex = cognitoCalls.indexOf(update);

  assert.ok(update);
  assert.ok(updateIndex >= 0 && updateIndex < authenticateIndex);
  assert.deepEqual(
    update.input.UserAttributes.find((item) => item.Name === 'custom:active_workspace_id'),
    { Name: 'custom:active_workspace_id', Value: 'workspace-b' },
  );
  assert.equal(storedSession.workspaceId, 'workspace-b');
  assert.equal(result.expiresIn, 60);
});
