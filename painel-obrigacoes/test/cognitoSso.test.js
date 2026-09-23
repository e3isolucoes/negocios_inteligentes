import test from 'node:test';
import assert from 'node:assert/strict';

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

test('restaura no painel a sessão Cognito já autenticada no portal', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.E3I_CONFIG = {
    authBackend: 'cognito', cognitoRegion: 'sa-east-1',
    cognitoUserPoolId: 'pool', cognitoClientId: 'client',
  };
  const { getSession, setSession } = await import('../js/api/auth.js');
  const access_token = jwt({
    iss: 'https://cognito-idp.sa-east-1.amazonaws.com/pool', aud: 'client', token_use: 'id',
    exp: Math.floor(Date.now() / 1000) + 3600, sub: 'user-1', email: 'usuario@empresa.com',
  });

  const restored = await setSession({ access_token, cognito_access_token: 'api-token', refresh_token: 'refresh' });

  assert.equal(restored.error, null);
  assert.equal(restored.data.session.user.id, 'user-1');
  assert.equal(restored.data.session.user.email, 'usuario@empresa.com');
  assert.equal((await getSession()).data.session.cognito_access_token, 'api-token');
  delete globalThis.E3I_CONFIG;
  delete globalThis.localStorage;
});

test('aceita sessão Supabase do usuário já cadastrado no Portal mesmo com backend AWS/Cognito', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.E3I_CONFIG = {
    authBackend: 'cognito', cognitoRegion: 'sa-east-1',
    cognitoUserPoolId: 'pool', cognitoClientId: 'client',
  };
  const { getSession, setSession } = await import('../js/api/auth.js');
  const access_token = jwt({
    iss: 'https://fsyginnpvonruifetjjs.supabase.co/auth/v1', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, sub: 'usuario-legado-1', email: 'cadastrado@empresa.com',
  });

  const restored = await setSession({ access_token });

  assert.equal(restored.error, null);
  assert.equal(restored.data.session.auth_provider, 'supabase');
  assert.equal(restored.data.session.user.id, 'usuario-legado-1');
  assert.equal(restored.data.session.user.email, 'cadastrado@empresa.com');
  assert.equal(restored.data.session.refresh_token, undefined);
  assert.equal((await getSession()).data.session.access_token, access_token);
  delete globalThis.E3I_CONFIG;
  delete globalThis.localStorage;
});

test('rejeita sessão SSO emitida para outro cliente Cognito', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.E3I_CONFIG = {
    authBackend: 'cognito', cognitoRegion: 'sa-east-1',
    cognitoUserPoolId: 'pool', cognitoClientId: 'client',
  };
  const { setSession } = await import('../js/api/auth.js');
  const access_token = jwt({
    iss: 'https://cognito-idp.sa-east-1.amazonaws.com/pool', aud: 'outro-client', token_use: 'id',
    exp: Math.floor(Date.now() / 1000) + 3600, sub: 'user-1',
  });

  const restored = await setSession({ access_token, refresh_token: 'refresh' });

  assert.equal(restored.data.session, null);
  assert.match(restored.error.message, /inválida ou expirada/);
  delete globalThis.E3I_CONFIG;
  delete globalThis.localStorage;
});

test('restaura sessão temporária da ferramenta sem exigir refresh token', async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.E3I_CONFIG = {
    authBackend: 'cognito', cognitoRegion: 'sa-east-1',
    cognitoUserPoolId: 'pool', cognitoClientId: 'client',
  };
  const { setSession } = await import('../js/api/auth.js');
  const access_token = jwt({
    iss: 'https://cognito-idp.sa-east-1.amazonaws.com/pool', aud: 'client', token_use: 'id',
    exp: Math.floor(Date.now() / 1000) + 3600, sub: 'user-portal', email: 'portal@empresa.com',
  });

  const restored = await setSession({ access_token, cognito_access_token: 'api-token' });

  assert.equal(restored.error, null);
  assert.equal(restored.data.session.user.id, 'user-portal');
  assert.equal(restored.data.session.refresh_token, undefined);
  delete globalThis.E3I_CONFIG;
  delete globalThis.localStorage;
});

test('trata resposta HTML 502 do gateway sem tentar interpretá-la como JSON', async () => {
  const { readPortalSsoResponse } = await import('../js/api/auth.js');
  let parsed = false;
  const response = {
    ok: false,
    status: 502,
    headers: { get: name => name === 'content-type' ? 'text/html; charset=utf-8' : null },
    json: async () => { parsed = true; throw new Error('Unexpected token <'); },
  };

  await assert.rejects(() => readPortalSsoResponse(response), error => (
    error.status === 502 && /temporariamente indisponível/.test(error.message)
  ));
  assert.equal(parsed, false);
});

test('preserva mensagem e request ID de erro JSON na troca do SSO', async () => {
  const { readPortalSsoResponse } = await import('../js/api/auth.js');
  const response = {
    ok: false,
    status: 401,
    headers: { get: name => name === 'content-type' ? 'application/json' : null },
    json: async () => ({ error: 'Código expirado.', requestId: 'request-1' }),
  };

  await assert.rejects(() => readPortalSsoResponse(response), error => (
    error.status === 401 && error.requestId === 'request-1' && error.message === 'Código expirado.'
  ));
});

test('trata body JSON nulo como objeto vazio na troca do SSO', async () => {
  const { readPortalSsoResponse } = await import('../js/api/auth.js');
  const response = {
    ok: false,
    status: 401,
    headers: { get: name => name === 'content-type' ? 'application/json' : null },
    json: async () => null,
  };

  await assert.rejects(() => readPortalSsoResponse(response), error => (
    error.status === 401 && error.requestId === null && error.message === 'Código de acesso inválido ou expirado.'
  ));
});
