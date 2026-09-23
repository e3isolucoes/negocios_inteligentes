import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('consome o código AWS de uso único do portal antes do fallback por postMessage', async () => {
  const [auth, app] = await Promise.all([
    readFile(new URL('../js/api/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(auth, /portal_sso_code/);
  assert.match(auth, /portal-session\/exchange/);
  assert.match(auth, /history\.replaceState/);
  assert.ok(app.indexOf('const portalSession = await completePortalSso()') < app.indexOf('await bootstrapPortalSession'));
});

test('aceita o ticket do Portal no mesmo formato de query string das demais ferramentas', async () => {
  const auth = await readFile(new URL('../js/api/auth.js', import.meta.url), 'utf8');
  assert.match(auth, /params\.get\('portal_sso_code'\) \|\| fragment\.get\('portal_sso_code'\)/);
  assert.match(auth, /params\.delete\('portal_sso_code'\)/);
  assert.match(auth, /fragment\.delete\('portal_sso_code'\)/);
});

test('entra imediatamente quando a sessão é entregue pelo frame do Portal', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /const embeddedPortalSession = await bootstrapPortalSession/);
  assert.match(app, /if \(embeddedPortalSession\) \{ await enterApp\(embeddedPortalSession\); return; \}/);
});
