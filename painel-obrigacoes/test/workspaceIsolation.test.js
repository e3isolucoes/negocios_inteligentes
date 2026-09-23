import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../sql/migrations/20260815_isolate_workspaces_by_cnpj.sql', import.meta.url);
const categoryRepairUrl = new URL('../sql/migrations/20260815_seed_workspace_categories.sql', import.meta.url);
const graAssignmentUrl = new URL('../sql/migrations/20260822_assign_existing_data_to_gra_comercio.sql', import.meta.url);

test('legacy records are assigned to the GRA Comercio workspace', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /GRA Comercio/);
  assert.match(sql, /00\.999\.175\/0001-54/);
  assert.match(sql, /update public\.workspaces[\s\S]*?set name = 'GRA Comercio'/);
  assert.match(sql, /update public\.companies set workspace_id=/);
  assert.match(sql, /update public\.obligations set workspace_id=/);
  assert.match(sql, /alter table public\.completions alter column workspace_id set not null/);
  assert.match(sql, /workspaces_document_cnpj_check/);
});

test('already isolated installations identify the legacy tenant as GRA Comercio', async () => {
  const sql = await readFile(graAssignmentUrl, 'utf8');
  assert.match(sql, /set name = 'GRA Comercio'/);
  assert.match(sql, /access_status = 'full'/);
  assert.match(sql, /00999175000154/);
  assert.match(sql, /if not exists/);
  assert.match(sql, /raise exception/);
});

test('completion backfill temporarily suspends legacy-only checks', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const dropAttachment = sql.indexOf('drop constraint if exists completions_attachment_required');
  const dropChecklist = sql.indexOf('drop constraint if exists completions_checklist_complete');
  const backfill = sql.indexOf('update public.completions c set workspace_id=');
  const restoreAttachment = sql.indexOf('add constraint completions_attachment_required', backfill);
  const restoreChecklist = sql.indexOf('add constraint completions_checklist_complete', backfill);

  assert.ok(dropAttachment >= 0 && dropAttachment < backfill);
  assert.ok(dropChecklist >= 0 && dropChecklist < backfill);
  assert.ok(restoreAttachment > backfill);
  assert.ok(restoreChecklist > backfill);
  assert.match(sql.slice(restoreAttachment, restoreChecklist), /not valid/);
  assert.match(sql.slice(restoreChecklist), /not valid/);
});

test('tenant RLS never grants the superuser implicit operational access', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.can_access_workspace/);
  const accessFunction = sql.match(/create or replace function public\.can_access_workspace[\s\S]*?\$\$;/)?.[0] || '';
  assert.doesNotMatch(accessFunction, /is_super_admin/);
  assert.match(sql, /public\.can_access_workspace\(workspace_id\)/);
  assert.match(sql, /Vínculo entre empresas diferentes/);
});

test('attachments are namespaced and protected by workspace', async () => {
  const [sql, storage] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(new URL('../js/api/storage.js', import.meta.url), 'utf8'),
  ]);
  assert.match(storage, /`\$\{workspaceId\}\/\$\{obligationId\}\//);
  assert.match(sql, /comprovantes_tenant_select/);
  assert.match(sql, /storage\.foldername\(name\)/);
});

test('every workspace is provisioned with categories required by composite foreign keys', async () => {
  const sql = await readFile(categoryRepairUrl, 'utf8');

  const addWorkspaceColumn = sql.indexOf('add column if not exists workspace_id');
  const seedExistingWorkspaces = sql.indexOf('insert into public.categories (workspace_id, name, cor, ordem, sistema)', addWorkspaceColumn);
  assert.ok(addWorkspaceColumn >= 0 && addWorkspaceColumn < seedExistingWorkspaces);
  assert.match(sql, /drop constraint if exists categories_name_key/);
  assert.match(sql, /create unique index if not exists categories_workspace_name_uidx/);
  assert.match(sql, /after insert on public\.workspaces/);
  assert.match(sql, /create or replace function public\.provision_workspace_categories/);
  assert.match(sql, /\(new\.id, 'federal'/);
  assert.match(sql, /cross join \(values/);
  assert.match(sql, /on conflict \(workspace_id, name\) do nothing/);
  assert.match(sql, /pg_trigger_depth\(\) > 1/);
  assert.match(sql, /if exists \([\s\S]*?tgname = 'trg_workspace_guard'/);
  assert.doesNotMatch(sql, /^alter table public\.categories disable trigger trg_workspace_guard;/m);
  assert.doesNotMatch(sql, /^alter table public\.categories enable trigger trg_workspace_guard;/m);
});
