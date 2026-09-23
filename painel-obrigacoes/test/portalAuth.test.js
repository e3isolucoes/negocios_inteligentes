import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PORTAL_ORIGIN, PORTAL_AUTH_REQUEST, PORTAL_AUTH_SESSION,
  bootstrapPortalSession, readPortalSession,
} from '../js/api/portalAuth.js';

test('aceita sessão somente da origem e do frame pai do Portal E3I', () => {
  const parent = {};
  const valid = {
    origin: DEFAULT_PORTAL_ORIGIN,
    source: parent,
    data: { type: PORTAL_AUTH_SESSION, session: { access_token: 'access', refresh_token: 'refresh' } },
  };
  assert.deepEqual(readPortalSession(valid, parent), { access_token: 'access', refresh_token: 'refresh' });
  assert.equal(readPortalSession({ ...valid, origin: 'https://malicioso.example' }, parent), null);
  assert.equal(readPortalSession({ ...valid, source: {} }, parent), null);
  assert.equal(readPortalSession({ ...valid, data: { type: PORTAL_AUTH_SESSION } }, parent), null);
});

test('preserva o access token do Cognito enviado pelo portal', () => {
  const parent = {};
  assert.deepEqual(readPortalSession({
    origin: DEFAULT_PORTAL_ORIGIN,
    source: parent,
    data: {
      type: PORTAL_AUTH_SESSION,
      session: { access_token: 'id', cognito_access_token: 'access', refresh_token: 'refresh' },
    },
  }, parent), { access_token: 'id', cognito_access_token: 'access', refresh_token: 'refresh' });
});

test('aceita handoff temporário do portal sem exigir a senha ou refresh token do painel', () => {
  const parent = {};
  assert.deepEqual(readPortalSession({
    origin: DEFAULT_PORTAL_ORIGIN,
    source: parent,
    data: { type: PORTAL_AUTH_SESSION, session: { IdToken: 'id', AccessToken: 'access' } },
  }, parent), { access_token: 'id', cognito_access_token: 'access' });
});

test('solicita a sessão ao portal e a restaura sem senha', async () => {
  const listeners = new Map();
  const parent = {
    postMessage(message, origin) {
      assert.deepEqual(message, { type: PORTAL_AUTH_REQUEST });
      assert.equal(origin, DEFAULT_PORTAL_ORIGIN);
      queueMicrotask(() => listeners.get('message')({
        origin,
        source: parent,
        data: { type: PORTAL_AUTH_SESSION, session: { access_token: 'a', refresh_token: 'r' } },
      }));
    },
  };
  const fakeWindow = {
    parent,
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout() {},
  };
  const restored = await bootstrapPortalSession({
    windowObject: fakeWindow,
    restoreSession: async (session) => ({ data: { session: { user: { id: '1' }, ...session } } }),
  });
  assert.equal(restored.user.id, '1');
});
