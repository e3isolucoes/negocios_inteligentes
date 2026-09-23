import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('centraliza o acesso ao Painel no Portal E3I', () => {
  const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../aws/template.yaml', import.meta.url), 'utf8');

  assert.match(page, /id="loginForm" class="hidden"/);
  assert.match(page, /href="https:\/\/portal\.e3isolucoes\.com\.br\/"/);
  assert.match(page, /id="portalLoginStatus" class="login-error hidden"/);
  assert.doesNotMatch(template, /ALLOW_USER_PASSWORD_AUTH/);
  assert.match(template, /ALLOW_ADMIN_USER_PASSWORD_AUTH/);
  assert.match(template, /ALLOW_REFRESH_TOKEN_AUTH/);
  assert.match(app, /showLogin\(error\.message \|\|/);
  assert.match(app, /console\.error\('Falha no acesso único do portal', error\)/);
});
