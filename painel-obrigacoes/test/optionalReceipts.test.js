import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('selected obligations are migrated to optional receipts with database enforcement', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260817_make_receipts_optional_for_selected_obligations.sql', import.meta.url), 'utf8');

  assert.match(sql, /add column if not exists requires_attachment boolean not null default true/);
  assert.match(sql, /set requires_attachment = false/);
  assert.match(sql, /Conciliacao bancaria/);
  assert.match(sql, /Destaque de IBS\/CBS - Simples Nacional/);
  assert.match(sql, /create trigger trg_enforce_completion_attachment/);
  assert.match(sql, /if new\.attachment_path is null[\s\S]*?o\.requires_attachment/);
});

test('completion flow only uploads and requires a file when configured', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');
  const dialog = await readFile(new URL('../js/ui/completeDialog.js', import.meta.url), 'utf8');

  assert.match(data, /requiresAttachment: ob\.requires_attachment !== false/);
  assert.match(data, /if \(result\.file\) \{[\s\S]*?uploadAttachment/);
  assert.match(dialog, /hasFile \|\| !effectiveRequirement/);
  assert.match(dialog, /effectiveRequirement && !file/);
  assert.match(dialog, /Comprovante \(\$\{effectiveRequirement \? 'obrigatório' : 'opcional'\}\)/);
  assert.match(dialog, /ocrConfirmCheckbox\.addEventListener\('change', updateEnabled\);[\s\S]*?updateEnabled\(\);\s*fileInput\.addEventListener/);
});

test('activity flow models processes and permits configured no-movement evidence exception', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260826_evolve_obligations_into_activities.sql', import.meta.url), 'utf8');
  const dialog = await readFile(new URL('../js/ui/completeDialog.js', import.meta.url), 'utf8');
  const modal = await readFile(new URL('../js/ui/modal.js', import.meta.url), 'utf8');

  assert.match(sql, /activity_type text not null default 'obrigacao_acessoria'/);
  assert.match(sql, /process_name text not null/);
  assert.match(sql, /predecessor_id uuid references public\.obligations/);
  assert.match(sql, /new\.movement_status = 'sem_movimento'/);
  assert.match(sql, /activity\.requires_attachment_no_movement = false/);
  assert.match(dialog, /effectiveRequirement = requiresAttachment && movementStatus\?\.value !== 'sem_movimento'/);
  assert.match(modal, /Atividade anterior na esteira/);
});
