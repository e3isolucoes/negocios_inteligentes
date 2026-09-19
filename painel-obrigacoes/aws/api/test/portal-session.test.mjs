import assert from 'node:assert/strict';
import test from 'node:test';
import { consumePortalSession } from '../src/portal-session.mjs';

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
