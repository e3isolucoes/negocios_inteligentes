import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimPortalProvisioningNonce,
  provisionPortalAccess,
  signLegacyPortalProvisioning,
  signPortalProvisioning,
  verifyPortalProvisioning,
} from '../src/portal-provisioning.mjs';

const secret = '0123456789abcdef0123456789abcdef';

test('aceita contrato moderno do Portal com nonce e timestamp em milissegundos', () => {
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ userId: 'user-1' });
  const timestamp = String(now);
  const nonce = 'N'.repeat(43);
  const signature = signPortalProvisioning(secret, timestamp, nonce, body);

  const verified = verifyPortalProvisioning({
    body,
    headers: {
      'x-e3i-timestamp': timestamp,
      'x-e3i-nonce': nonce,
      'x-e3i-signature': signature,
    },
  }, secret, now);

  assert.equal(verified.nonce, nonce);
  assert.equal(verified.legacy, false);
});

test('aceita timestamp Unix em segundos no contrato moderno', () => {
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const body = JSON.stringify({ userId: 'user-1' });
  const nonce = 'S'.repeat(43);
  const signature = signPortalProvisioning(secret, timestamp, nonce, body);

  assert.doesNotThrow(() => verifyPortalProvisioning({
    body,
    headers: {
      'x-e3i-timestamp': timestamp,
      'x-e3i-nonce': nonce,
      'x-e3i-signature': signature,
    },
  }, secret, now));
});

test('mantém compatibilidade temporária com assinatura legada sem nonce', () => {
  const now = 1_800_000_000_000;
  const timestamp = String(now);
  const body = JSON.stringify({ userId: 'user-1' });
  const signature = signLegacyPortalProvisioning(secret, timestamp, body);

  const verified = verifyPortalProvisioning({
    body,
    headers: {
      'x-e3i-timestamp': timestamp,
      'x-e3i-signature': signature,
    },
  }, secret, now);

  assert.equal(verified.legacy, true);
  assert.match(verified.nonce, /^[A-Za-z0-9_-]{32,128}$/);
});

test('rejeita assinatura inválida e solicitação expirada', () => {
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ userId: 'user-1' });
  const timestamp = String(now);
  const nonce = 'X'.repeat(43);

  assert.throws(() => verifyPortalProvisioning({
    body,
    headers: {
      'x-e3i-timestamp': timestamp,
      'x-e3i-nonce': nonce,
      'x-e3i-signature': '0'.repeat(64),
    },
  }, secret, now), /Assinatura/);

  const expired = String(now - 180_000);
  const signature = signPortalProvisioning(secret, expired, nonce, body);
  assert.throws(() => verifyPortalProvisioning({
    body,
    headers: {
      'x-e3i-timestamp': expired,
      'x-e3i-nonce': nonce,
      'x-e3i-signature': signature,
    },
  }, secret, now), /expirada/);
});

test('claim de nonce impede replay', async () => {
  let used = false;
  const client = {
    send: async () => {
      if (used) {
        const error = new Error('duplicate');
        error.name = 'ConditionalCheckFailedException';
        throw error;
      }
      used = true;
      return {};
    },
  };

  await claimPortalProvisioningNonce(client, 'table', 'R'.repeat(43), 1_900_000_000_000);
  await assert.rejects(
    () => claimPortalProvisioningNonce(client, 'table', 'R'.repeat(43), 1_900_000_000_000),
    /Nonce já utilizado/,
  );
});

test('provisiona vínculo genérico sem exigir documento cadastral', async () => {
  let command;
  const client = { send: async (value) => { command = value; return {}; } };

  const result = await provisionPortalAccess(client, 'table', {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    email: 'Pessoa@Empresa.com.br',
    displayName: 'Pessoa Teste',
    workspaceName: 'Empresa Teste',
    document: '',
  });

  assert.deepEqual(result, { userId: 'user-1', workspaceId: 'workspace-1', role: 'member' });
  assert.equal(command.input.TransactItems.length, 4);
  assert.deepEqual(command.input.TransactItems[0].Update.Key, {
    PK: 'WORKSPACE#workspace-1',
    SK: 'MEMBER#user-1',
  });
  assert.equal(command.input.TransactItems[0].Update.ExpressionAttributeValues[':gsi1pk'], 'MEMBER#user-1');
  assert.equal(command.input.TransactItems[0].Update.ExpressionAttributeValues[':gsi1sk'], 'WORKSPACE#workspace-1');
  assert.equal(command.input.TransactItems[0].Update.ExpressionAttributeValues[':memberEntity'], 'member');
  assert.deepEqual(command.input.TransactItems[0].Update.ExpressionAttributeValues[':defaultModuleGrants'], ['obrigacoes']);
  assert.match(command.input.TransactItems[0].Update.UpdateExpression, /if_not_exists\(#role,:member\)/);
  assert.match(command.input.TransactItems[0].Update.UpdateExpression, /module_grants=if_not_exists\(module_grants,:defaultModuleGrants\)/);
  assert.equal(command.input.TransactItems[3].Put.Item.action, 'PORTAL_ACCESS_PROVISIONED');
});
