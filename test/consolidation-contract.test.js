import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STATE,
  hasAdministrationAccess,
} from '../painel-obrigacoes/js/state.js';

test('Administração é explícita para delegados e implícita apenas para Admin da Ferramenta', () => {
  STATE.profile = { role: 'gestor', active: true, module_grants: ['obrigacoes'] };
  assert.equal(hasAdministrationAccess(), false);

  STATE.profile = { role: 'manager', active: true, module_grants: ['obrigacoes', 'administracao'] };
  assert.equal(hasAdministrationAccess(), true);

  STATE.profile = { role: 'admin', active: true, module_grants: [] };
  assert.equal(hasAdministrationAccess(), true);
});

test('design system consolidado está no repositório canônico', async () => {
  const css = await readFile(new URL('../painel-obrigacoes/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /E3I DESIGN SYSTEM — UNIFIED UI 2026-09/);
  assert.match(css, /--ds-font-ui/);
  assert.match(css, /--ds-surface/);
  assert.match(css, /\.related-companies-tags/);
});

test('histórico visual usa snapshot de conclusão e histórico estrutural', async () => {
  const [stateSource, boardSource] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/js/state.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8'),
  ]);

  assert.match(stateSource, /obligationForCompletion/);
  assert.match(stateSource, /competenceForCompletion/);
  assert.match(stateSource, /structure_history/);
  assert.match(boardSource, /competenceForCompletion/);
  assert.match(boardSource, /renderRelatedCompaniesTags/);
});

test('assets do módulo usam a mesma versão consolidada de cache', async () => {
  const [index, app, render] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/render.js', import.meta.url), 'utf8'),
  ]);
  const version = '20260920-canonical-v1';
  assert.match(index, new RegExp(version));
  assert.match(app, new RegExp(version));
  assert.match(render, new RegExp(version));
});


test('Painel remove chrome duplicado quando montado no shell global', async () => {
  const [appSource, css] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/css/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(appSource, /window\.self !== window\.top/);
  assert.match(appSource, /embedded-module/);
  assert.match(css, /body\.embedded-module \.app-sidebar/);
  assert.match(css, /body\.embedded-module \.global-header/);
});
