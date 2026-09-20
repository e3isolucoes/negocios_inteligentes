import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeChecklistItem } from '../painel-obrigacoes/js/api/checklist.js';

test('checklist AWS normaliza done para completed sem perder compatibilidade', () => {
  assert.deepEqual(
    normalizeChecklistItem({ id: 'a', done: true }),
    { id: 'a', done: true, completed: true },
  );
  assert.deepEqual(
    normalizeChecklistItem({ id: 'b', completed: true }),
    { id: 'b', completed: true, done: true },
  );
  assert.deepEqual(
    normalizeChecklistItem({ id: 'c', done: false }),
    { id: 'c', done: false, completed: false },
  );
});

test('cartão mostra prontidão antes da pessoa tentar concluir', async () => {
  const board = await readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../painel-obrigacoes/css/styles.css', import.meta.url), 'utf8');

  assert.match(board, /completionReadinessPreview/);
  assert.match(board, /Checklist/);
  assert.match(board, /Comprovante no envio/);
  assert.match(board, /Definir outro validador/);
  assert.match(board, /completion-card-readiness/);

  assert.match(css, /\.completion-card-readiness\{/);
  assert.match(css, /\.completion-card-step\.is-blocked/);
  assert.match(css, /\.completion-card-step\.is-ready/);
});

test('diálogo bloqueia enquanto checklist ainda está salvando e explica cada impedimento', async () => {
  const dialog = await readFile(new URL('../painel-obrigacoes/js/ui/completeDialog.js', import.meta.url), 'utf8');

  assert.match(dialog, /pendingChecklistSaves/);
  assert.match(dialog, /Aguarde: estamos salvando o checklist/);
  assert.match(dialog, /Anexe o comprovante obrigatório/);
  assert.match(dialog, /A Gestão precisa definir um validador/);
  assert.match(dialog, /Faltam \$\{blockers\.length\} requisito/);
});

test('todos os papéis operacionais permanecem previstos na API de Obrigações', async () => {
  const repository = await readFile(new URL('../painel-obrigacoes/aws/api/src/repository-obrigacoes.mjs', import.meta.url), 'utf8');
  assert.match(repository, /\['member', 'manager', 'admin', 'super_admin'\]/);
  assert.match(repository, /assertCompletionReady/);
  assert.match(repository, /completion_checklist_incomplete/);
  assert.match(repository, /completion_attachment_required/);
  assert.match(repository, /completion_validator_missing/);
});
