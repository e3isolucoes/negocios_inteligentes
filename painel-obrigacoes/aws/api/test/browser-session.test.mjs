import assert from 'node:assert/strict';
import test from 'node:test';
import { issueBrowserSession, readRefreshCookie, refreshCookie, revokeBrowserSession, rotateBrowserSession } from '../src/browser-session.mjs';

test('cookie de refresh aplica atributos seguros e não expõe o token no corpo', () => {
  assert.equal(readRefreshCookie({ cookie: 'other=x; __Host-e3i_refresh=opaque' }), 'opaque');
  assert.match(refreshCookie('opaque'), /^__Host-e3i_refresh=opaque; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=None$/);
});

test('rotaciona uma vez e revoga a família quando o token anterior é reutilizado', async () => {
  const records = new Map();
  const key = input => input.Key?.PK || input.Item?.PK;
  const ddb = { send: async command => {
    const name = command.constructor.name;
    if (name === 'PutCommand') { records.set(key(command.input), { ...command.input.Item }); return {}; }
    if (name === 'GetCommand') return { Item: records.get(key(command.input)) };
    if (name === 'UpdateCommand') {
      const item = records.get(key(command.input));
      if (command.input.ConditionExpression && item.status !== 'active') throw new Error('conditional');
      if (command.input.UpdateExpression.includes('#status')) item.status = 'rotated'; else item.revoked = true;
      return {};
    }
    throw new Error(`Comando inesperado: ${name}`);
  } };
  const cognitoCalls = [];
  const cognito = { send: async command => {
    cognitoCalls.push(command.constructor.name);
    if (command.constructor.name === 'AdminInitiateAuthCommand') return { AuthenticationResult: { IdToken: 'id-new', AccessToken: 'access-new' } };
    return {};
  } };
  const first = await issueBrowserSession(ddb, 'table', 'provider-refresh', 1_900_000_000_000);
  const rotated = await rotateBrowserSession(cognito, ddb, 'table', { userPoolId: 'pool', clientId: 'client' }, first, 1_900_000_001_000);
  assert.equal(rotated.access_token, 'id-new');
  assert.notEqual(rotated.cookieToken, first);
  await assert.rejects(() => rotateBrowserSession(cognito, ddb, 'table', { userPoolId: 'pool', clientId: 'client' }, first, 1_900_000_002_000), /Reutilização/);
  assert.ok(cognitoCalls.includes('RevokeTokenCommand'));
});

test('logout revoga no provedor e marca a família server-side', async () => {
  const commands = [];
  const item = { entityType: 'browser_session', familyId: 'family', refreshToken: 'provider-token', status: 'active' };
  const ddb = { send: async command => { commands.push(command); return command.constructor.name === 'GetCommand' ? { Item: item } : {}; } };
  const cognito = { send: async command => { commands.push(command); return {}; } };
  await revokeBrowserSession(cognito, ddb, 'table', 'client', 'opaque');
  assert.ok(commands.some(command => command.constructor.name === 'UpdateCommand'));
  assert.ok(commands.some(command => command.constructor.name === 'RevokeTokenCommand'));
});
