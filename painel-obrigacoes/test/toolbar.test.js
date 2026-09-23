import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATE } from '../js/state.js';
import { renderToolbar, renderSidebarNavigation } from '../js/ui/toolbar.js';

function resetState() {
  STATE.profile = { role: 'membro', active: true };
  STATE.session = { id: 'user-1' };
  STATE.obligations = [];
  STATE.completions = [];
  STATE.companies = [];
  STATE.activeModule = 'all';
  STATE.filters = {
    empresa: 'all', category: 'all', responsible: 'all', status: 'all', receipt: 'all', competence: 'all',
  };
  STATE.validation = { pending: 0, rejected: 0 };
  STATE.view = 'board';
}

test('sidebar identifica a navegação atual e toolbar fica dedicada a filtros', () => {
  resetState();
  const nav = renderSidebarNavigation();
  const html = renderToolbar();

  assert.match(nav, /<nav class="side-nav" aria-label="Navegação principal">/);
  assert.match(nav, /data-tab="board" aria-current="page"/);
  assert.doesNotMatch(html, /class="tabs"/);
  assert.match(html, /class="toolbar workspace-filters"/);
  assert.match(html, /aria-haspopup="listbox" aria-expanded="false"/);
  assert.match(html, /role="option" aria-selected="true"/);
  assert.match(html, /data-action="module-filter"[^>]*aria-label="Todos os módulos"/);
  assert.match(html, /data-action="filter-select" data-filter="competence"[^>]*aria-label="Todas as competências"/);
  assert.match(html, /data-action="clear-filters"[^>]*disabled[^>]*>Remover filtros/);
  assert.match(html, /data-dd="status" data-value="today"[^>]*>Vence hoje/);
  assert.match(html, /data-action="new">\+ Nova atividade/);
});

test('toolbar identifica Vence hoje como status selecionado', () => {
  resetState();
  STATE.filters.status = 'today';

  const html = renderToolbar();

  assert.match(html, /class="dd-label">Vence hoje<\/span>/);
  assert.match(html, /data-dd="status" data-value="today"[^>]*aria-selected="true"[^>]*>Vence hoje/);
});

test('toolbar sinaliza e permite remover filtros ativos', () => {
  resetState();
  STATE.filters.empresa = 'empresa-1';
  STATE.filters.status = 'red';

  const html = renderToolbar();

  assert.match(html, /data-action="clear-filters"/);
  assert.doesNotMatch(html, /data-action="clear-filters"[^>]*disabled/);
  assert.match(html, />Remover filtros <span>2<\/span>/);
});

test('toolbar contabiliza o filtro de comprovante', () => {
  resetState();
  STATE.filters.receipt = 'missing';

  const html = renderToolbar();

  assert.match(html, /class="dd-label">Sem comprovante<\/span>/);
  assert.match(html, />Remover filtros <span>1<\/span>/);
});

test('toolbar mantém módulo selecionado e contabiliza o filtro', () => {
  resetState();
  STATE.activeModule = 'fiscal';
  STATE.filters.competence = '2026-08';
  STATE.obligations = [{ id: 'ob-1', module_key: 'fiscal', competence_offset_months: 1, frequency: 'pontual', due_date: '2026-09-20' }];

  const html = renderToolbar();

  assert.doesNotMatch(html, /data-action="module"/);
  assert.match(html, /data-action="module-filter"[^>]*>[\s\S]*<option value="fiscal" selected>Fiscal<\/option>/);
  assert.match(html, />Remover filtros <span>2<\/span>/);
});
