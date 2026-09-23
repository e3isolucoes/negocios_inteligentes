import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CSP permits OCR eval while keeping script elements restricted to trusted origins', async () => {
  const config = JSON.parse(await readFile(new URL('../staticwebapp.config.json', import.meta.url), 'utf8'));
  const csp = config.globalHeaders['Content-Security-Policy'];

  assert.match(csp, /script-src[^;]*'unsafe-eval'/);
  assert.match(csp, /script-src-elem 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /script-src-elem[^;]*'unsafe-(?:eval|inline)'/);
  assert.match(await readFile(new URL('../index.html', import.meta.url), 'utf8'), /vendor\/supabase-2\.112\.3\/supabase\.js/);
  assert.match(csp, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /frame-ancestors https:\/\/portal\.e3isolucoes\.com\.br/);
  assert.equal(config.globalHeaders['X-Frame-Options'], undefined);
});

test('login form labels are explicitly associated with their fields', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of ['loginEmail', 'loginPassword', 'newPasswordInput']) {
    assert.match(html, new RegExp(`<label\\s+for=["']${id}["']>`));
    assert.match(html, new RegExp(`<input\\s+id=["']${id}["']`));
  }
});

test('deployment remains connected to the existing Supabase project', async () => {
  const config = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');

  assert.match(config, /SUPABASE_URL = 'https:\/\/fsyginnpvonruifetjjs\.supabase\.co'/);
  assert.doesNotMatch(config, /SEU_PROJETO|sb_publishable_\.\.\./);
});

test('AWS panel keeps a safe public configuration module in the repository', async () => {
  const config = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(config, /SUPABASE_ANON_KEY = ''/);
  assert.doesNotMatch(ignore, /(?:^|\n)js\/config\.js(?:\n|$)/);
});

test('admin can complete an activity without a second validator', async () => {
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');

  assert.match(schema, /executor_admin := is_admin\(new\.done_by\)/);
  assert.match(schema, /exigir and not executor_admin then 'aguardando_validacao' else 'validada'/);
  assert.match(schema, /if not exigir or executor_admin then new\.validated_at:=now\(\); new\.validated_by:=new\.done_by/);
  assert.match(data, /!ob\.validator_id && !isAdmin\(\)/);
  assert.match(data, /ob\.validator_id === STATE\.session\?\.id && !isAdmin\(\)/);
});
