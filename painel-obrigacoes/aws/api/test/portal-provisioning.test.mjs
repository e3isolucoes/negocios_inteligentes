import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionPortalAccess, signPortalProvisioning, verifyPortalProvisioning } from '../src/portal-provisioning.mjs';

const secret = '0123456789abcdef0123456789abcdef';

test('aceita somente provisionamento recente e assinado pelo Portal E3I', () => {
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ userId: 'user-1' });
  const timestamp = String(now);
  const signature = signPortalProvisioning(secret, timestamp, body);
  assert.doesNotThrow(() => verifyPortalProvisioning({ body, headers: { 'x-e3i-timestamp': timestamp, 'x-e3i-signature': signature } }, secret, now));
  assert.throws(() => verifyPortalProvisioning({ body, headers: { 'x-e3i-timestamp': timestamp, 'x-e3i-signature': '0'.repeat(64) } }, secret, now), /Assinatura/);
  assert.throws(() => verifyPortalProvisioning({ body, headers: { 'x-e3i-timestamp': String(now - 180_000), 'x-e3i-signature': signature } }, secret, now), /expirada/);
});

test('provisiona vínculo, perfil, empresa e auditoria sem sobrescrever papéis existentes', async () => {
  let command;
  const client = { send: async (value) => { command = value; } };
  const result = await provisionPortalAccess(client, 'table', {
    userId: 'user-1', workspaceId: 'workspace-1', email: 'Pessoa@Empresa.com.br',
    displayName: 'Pessoa Teste', workspaceName: 'Empresa Teste', document: '12.345.678/0001-90',
  });
  assert.deepEqual(result, { userId: 'user-1', workspaceId: 'workspace-1', role: 'member' });
  assert.equal(command.input.TransactItems.length, 4);
  assert.match(command.input.TransactItems[0].Update.UpdateExpression, /if_not_exists\(#role,:member\)/);
  assert.match(command.input.TransactItems[1].Update.UpdateExpression, /if_not_exists\(#role,:legacyMember\)/);
  assert.equal(command.input.TransactItems[3].Put.Item.action, 'PORTAL_ACCESS_PROVISIONED');
});
