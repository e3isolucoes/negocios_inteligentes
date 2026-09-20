import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('sessão canônica não persiste tokens no storage do navegador', async () => {
  const source = await readFile(new URL('../painel-obrigacoes/js/api/auth.js', import.meta.url), 'utf8');

  assert.match(source, /let memorySession = null/);
  assert.match(source, /delete memorySession\.refresh_token/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
  assert.doesNotMatch(source, /sessionStorage\.setItem/);
  assert.doesNotMatch(source, /JSON\.stringify\(session\).*storage/i);
});

test('refresh usa cookie HttpOnly e evita chamadas concorrentes', async () => {
  const source = await readFile(new URL('../painel-obrigacoes/js/api/auth.js', import.meta.url), 'utf8');

  assert.match(source, /credentials: 'include'/);
  assert.match(source, /browserRefreshPromise/);
  assert.match(source, /sessionCall\('\/refresh'/);
  assert.match(source, /export async function refreshAccessToken/);
  assert.match(source, /portal_sso_code/);
  assert.match(source, /params\.get\('portal_sso_code'\) \|\| fragment\.get\('portal_sso_code'\)/);
});
