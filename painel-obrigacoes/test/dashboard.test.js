import test from 'node:test';
import assert from 'node:assert/strict';

import { STATE } from '../js/state.js';
import { renderDashboard } from '../js/ui/dashboard.js';
import { selecionarVisaoExecutiva } from '../js/ui/executiveView.js';

test('dashboard executivo organiza a narrativa da saúde até a ação', () => {
  STATE.profile = { role: 'admin', active: true };
  STATE.obligations = [];
  STATE.companies = [];
  STATE.completions = [];
  STATE.occurrenceOverrides = [];
  STATE.holidays = [];
  STATE.checklistItems = [];

  const html = renderDashboard();

  assert.match(html, /Índice de saúde/);
  assert.match(html, /Leitura executiva/);
  assert.match(html, /O que fazer agora/);
  assert.match(html, /Andamento da carteira/);
  assert.match(html, /Mapa das áreas de gestão/);
  assert.match(html, /Avanço médio/);
  assert.match(html, /Ritmo por responsável/);
  assert.match(html, /aria-label="Avanço médio da carteira"/);
  assert.match(html, /Riscos e predições/);
  assert.match(html, /Explorar diagnóstico completo/);
  assert.match(html, /aria-label="Índice de saúde 100 de 100"/);
});

test('dashboard consolida atividades por área administrativa sem alterar o modelo existente', () => {
  selecionarVisaoExecutiva('Geral');
  STATE.profile = { role: 'gestor', active: true };
  STATE.obligations = [{
    id: 'atividade-1', name: 'Revisar fluxo de caixa', category: 'federal', module_key: 'financeiro',
    priority: 'alta', responsible: 'Ana', frequency: 'pontual', start_date: '2099-01-01',
  }];
  STATE.companies = [];
  STATE.completions = [];
  STATE.occurrenceOverrides = [];
  STATE.holidays = [];
  STATE.checklistItems = [{ obligation_id: 'atividade-1', position: 1, completed: true }];

  const html = renderDashboard();
  assert.match(html, /Financeiro/);
  assert.match(html, /Avanço médio de Financeiro/);
  assert.match(html, /Responsáveis definidos/);
  assert.match(html, /data-module="financeiro"/);
});

test('dashboard permanece restrito a administradores', () => {
  STATE.profile = { role: 'member', active: true };
  assert.match(renderDashboard(), /restrita a administradores/);
});

test('dashboard explica a previsão inteligente em linguagem simples', () => {
  STATE.profile = { role: 'admin', active: true };
  STATE.obligations = [];
  STATE.companies = [];
  STATE.completions = [];
  STATE.occurrenceOverrides = [];
  STATE.holidays = [];
  STATE.checklistItems = [];

  const html = renderDashboard();
  assert.match(html, /Previsão de possíveis atrasos/);
  assert.match(html, /Ainda não há histórico suficiente/);
  assert.match(html, /não uma certeza/);
});
