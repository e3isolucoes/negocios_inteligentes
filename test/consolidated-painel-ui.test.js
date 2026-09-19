import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('repositório canônico contém shell premium e design system unificado', async () => {
  const [css, render, toolbar, index] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/css/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/render.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/ui/toolbar.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(css, /PREMIUM APP SHELL — 2026-09/);
  assert.match(css, /E3I DESIGN SYSTEM — UNIFIED UI 2026-09/);
  assert.match(render, /class="app-frame"/);
  assert.match(render, /class="app-sidebar"/);
  assert.match(render, /class="global-header"/);
  assert.match(toolbar, /renderSidebarNavigation/);
  assert.match(toolbar, /class="toolbar workspace-filters"/);
  assert.match(index, /20260919-consolidated-v1/);
});

test('competência histórica é preservada sem remover extensões do repositório novo', async () => {
  const [state, board] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/js/state.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8'),
  ]);

  assert.match(state, /function obligationForCompletion/);
  assert.match(state, /function competenceForCompletion/);
  assert.match(state, /structure_history/);
  assert.match(board, /competenceForCompletion/);
  assert.match(board, /renderRelatedCompaniesTags/);
});

test('filtros consolidados incluem módulo e competência', async () => {
  const [app, toolbar, state] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/ui/toolbar.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/state.js', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /module-filter/);
  assert.match(app, /filter-select/);
  assert.match(toolbar, /Todas as competências/);
  assert.match(state, /competence: 'all'/);
});
