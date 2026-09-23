import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('bulk import falls back to one atomic RLS-protected insert when the RPC is absent', async () => {
  const api = await readFile(new URL('../js/api/obligations.js', import.meta.url), 'utf8');

  assert.match(api, /\.rpc\('import_obligations', \{ p_items: workspaceItems \}\)/);
  assert.match(api, /error\?\.code === 'PGRST202'/);
  assert.match(api, /\.from\('obligations'\)\.insert\(workspaceItems\)\.select\(\)/);
  assert.doesNotMatch(api, /BATCH_SIZE|Falha ao desfazer importação parcial/);
});

test('single obligation creation uses the authenticated RLS insert available to members', async () => {
  const api = await readFile(new URL('../js/api/obligations.js', import.meta.url), 'utf8');
  const createFunction = api.match(/export async function createObligation\(ob\)[\s\S]*?\n}/)?.[0] || '';

  assert.match(createFunction, /\.insert\(withCurrentWorkspace\(ob\)\)/);
  assert.doesNotMatch(createFunction, /import_obligations/);
});

test('import RPC preserves every field submitted by the obligation form', async () => {
  const migration = await readFile(new URL('../sql/migrations/20260813_fix_import_obligations.sql', import.meta.url), 'utf8');

  for (const column of ['priority', 'business_day_shift', 'requires_validation', 'validator_id']) {
    assert.match(migration, new RegExp(`item->>'${column}'`));
  }
});

test('import RPC enforces authentication and admin access before bypassing RLS', async () => {
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const functionSql = schema.match(/create or replace function import_obligations[\s\S]*?grant execute on function import_obligations\(jsonb\) to authenticated;/)?.[0] || '';

  assert.match(functionSql, /security definer/i);
  assert.match(functionSql, /auth\.uid\(\) is null/);
  assert.match(functionSql, /not is_admin\(auth\.uid\(\)\)/);
  assert.match(functionSql, /jsonb_array_length\(p_items\) > 2000/);
  assert.match(functionSql, /revoke all on function import_obligations\(jsonb\) from public/);
  assert.match(functionSql, /grant execute on function import_obligations\(jsonb\) to authenticated/);
});

test('obligations table does not force RLS on the validated security-definer importer', async () => {
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');

  assert.match(schema, /alter table obligations no force row level security;/i);
});

test('deployed entry module is cache-busted so browsers stop using the old batched importer', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const render = await readFile(new URL('../js/render.js', import.meta.url), 'utf8');
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');
  const azure = JSON.parse(await readFile(new URL('../staticwebapp.config.json', import.meta.url), 'utf8'));

  assert.match(html, /js\/app\.js\?v=[^"']+/);
  assert.match(app, /\.\/data\.js\?v=[^"']+/);
  assert.match(app, /\.\/render\.js\?v=[^"']+/);
  assert.match(render, /\.\/data\.js\?v=[^"']+/);
  assert.match(data, /\.\/api\/obligations\.js\?v=[^"']+/);
  assert.ok(azure.routes.some((rule) => (
    rule.route.includes('js,html,json')
      && /no-store/.test(rule.headers['Cache-Control'])
  )));
});

test('import errors report denied admin access without requiring a schema update', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');
  const api = await readFile(new URL('../js/api/obligations.js', import.meta.url), 'utf8');

  assert.match(data, /err\.code === '42501'/);
  assert.match(data, /perfil administrador ativo/);
  assert.match(api, /error\.importRpcMissing = true/);
  assert.match(data, /20260813_fix_import_obligations\.sql/);
  assert.doesNotMatch(data, /função segura de importação ainda não está instalada/);
});

test('import migration reloads the PostgREST schema cache', async () => {
  const migration = await readFile(new URL('../sql/migrations/20260813_fix_import_obligations.sql', import.meta.url), 'utf8');

  assert.match(migration, /create or replace function public\.import_obligations/i);
  assert.match(migration, /alter table public\.obligations no force row level security/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});

test('import hotfix upgrades old frequency constraints to accept daily obligations', async () => {
  const migration = await readFile(new URL('../sql/migrations/20260813_fix_import_obligations.sql', import.meta.url), 'utf8');

  assert.match(migration, /drop constraint if exists obligations_frequency_check/i);
  assert.match(migration, /frequency in \('diaria', 'mensal', 'trimestral', 'anual', 'pontual'\)/i);
  assert.match(migration, /drop constraint if exists frequency_fields_check/i);
  assert.match(migration, /frequency = 'diaria'/i);
});

test('constraint errors explain how to upgrade an existing Supabase database', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');

  assert.match(data, /err\.code === '23514'/);
  assert.match(data, /frequency_fields_check/i);
  assert.match(data, /banco ainda não aceita a frequência diária/i);
  assert.match(data, /20260813_fix_import_obligations\.sql/);
});
