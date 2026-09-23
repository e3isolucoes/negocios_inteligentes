import assert from 'node:assert/strict';
import test from 'node:test';

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

test('mantém access token somente em memória e nunca grava credenciais nos storages', async () => {
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (...args) => writes.push(['local', ...args]), removeItem() {} };
  globalThis.sessionStorage = { getItem: () => null, setItem: (...args) => writes.push(['session', ...args]), removeItem() {} };
  globalThis.E3I_CONFIG = { authBackend: 'cognito', cognitoRegion: 'sa-east-1', cognitoUserPoolId: 'pool', cognitoClientId: 'client', awsApiBase: 'https://api.example' };
  const { getSession, setSession } = await import('../js/api/auth.js');
  const accessToken = jwt({ iss: 'https://cognito-idp.sa-east-1.amazonaws.com/pool', aud: 'client', token_use: 'id', exp: Math.floor(Date.now() / 1000) + 900, sub: 'user-1' });
  await setSession({ access_token: accessToken, cognito_access_token: 'api-access', refresh_token: 'must-not-be-visible' });
  const session = (await getSession()).data.session;
  assert.equal(session.access_token, accessToken);
  assert.equal(session.refresh_token, undefined);
  assert.deepEqual(writes, []);
  delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.E3I_CONFIG;
});

test('logout chama revogação server-side com o cookie e limpa a sessão em memória', async () => {
  globalThis.E3I_CONFIG = { authBackend: 'cognito', awsApiBase: 'https://api.example' };
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 204, json: async () => ({}) }; };
  const { signOut, getSession } = await import('../js/api/auth.js');
  await signOut();
  assert.equal(calls[0].url, 'https://api.example/v1/session');
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal((await getSession()).data.session, null);
  delete globalThis.fetch; delete globalThis.E3I_CONFIG;
});
