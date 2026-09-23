import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATE } from '../js/state.js';
import { renderBoard } from '../js/ui/board.js';

function isoFromToday(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function resetState() {
  STATE.profile = { role: 'membro', active: true };
  STATE.session = { id: 'user-1', email: 'user@example.com' };
  STATE.obligations = [];
  STATE.companies = [];
  STATE.completions = [];
  STATE.occurrenceOverrides = [];
  STATE.holidays = [];
  STATE.checklistItems = [];
  STATE.filters = {
    empresa: 'all', category: 'all', responsible: 'all', status: 'all', receipt: 'all',
  };
}

test('painel apresenta o resumo operacional mesmo sem ocorrências', () => {
  resetState();

  const html = renderBoard();

  assert.match(html, /GESTÃO À VISTA · AGORA/);
  assert.match(html, /prazos prioritários/);
  assert.match(html, /ocorrências acompanhadas/);
  assert.match(html, /Nenhuma obrigação corresponde a este filtro/);
});

test('filtro de status concentra o painel na situação selecionada', () => {
  resetState();
  STATE.obligations = [
    {
      id: 'overdue', name: 'Obrigação atrasada', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(-2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
    {
      id: 'soon', name: 'Obrigação próxima', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
  ];
  STATE.filters.status = 'red';

  const html = renderBoard();

  assert.match(html, /Obrigação atrasada/);
  assert.doesNotMatch(html, /Obrigação próxima/);
  assert.match(html, /ocorrências acompanhadas/);
});

test('cabeçalhos do kanban separam título, contador e orientação', () => {
  resetState();
  STATE.obligations = [{
    id: 'soon', name: 'Obrigação próxima', category: 'federal', frequency: 'pontual',
    due_date: isoFromToday(2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
    company_id: null, business_day_shift: 'nenhum',
  }];

  const html = renderBoard();

  assert.match(html, /class="kanban-column-title-row"/);
  assert.match(html, /class="kanban-column-title"[^>]*>.*class="kanban-column-copy"><h3 id="kanban-amber">Vencem em breve<\/h3><small class="kanban-column-hint">Até 5 dias<\/small><\/div>/);
  assert.match(html, /class="kanban-count"[^>]*>1<\/span><\/div><\/header>/);
  assert.equal((html.match(/class="kanban-column-hint"/g) || []).length, 4);
});

test('filtro de status Vence hoje mostra somente demandas do dia', () => {
  resetState();
  STATE.obligations = [
    {
      id: 'today', name: 'Status vence hoje', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(0), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
    {
      id: 'tomorrow', name: 'Status vence amanhã', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(1), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
  ];
  STATE.filters.status = 'today';

  const html = renderBoard();

  assert.match(html, /Status vence hoje/);
  assert.doesNotMatch(html, /Status vence amanhã/);
});

test('filtro de comprovante mostra somente demandas sem evidência anexada', () => {
  resetState();
  STATE.obligations = [
    {
      id: 'with-receipt', name: 'Demanda com comprovante', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
    {
      id: 'without-receipt', name: 'Demanda sem comprovante', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
  ];
  STATE.completions = [{
    obligation_id: 'with-receipt', occurrence_date: isoFromToday(-30), done_at: `${isoFromToday(-30)}T12:00:00Z`,
    done_by_name: 'Ana', attachment_path: 'comprovantes/arquivo.pdf', status: 'aprovada',
  }];
  STATE.filters.receipt = 'missing';

  const html = renderBoard();

  assert.doesNotMatch(html, /Demanda com comprovante/);
  assert.match(html, /Demanda sem comprovante/);
});

test('painel organiza ocorrências em um kanban completo e acessível', () => {
  resetState();
  STATE.obligations = [{
    id: 'overdue', name: 'Obrigação atrasada', category: 'federal', frequency: 'pontual',
    due_date: isoFromToday(-2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
    company_id: null, business_day_shift: 'nenhum',
  }];

  const html = renderBoard();

  assert.match(html, /aria-label="Kanban de prazos"/);
  assert.match(html, /Pendências por prioridade/);
  assert.match(html, /AINDA FALTA/);
  assert.match(html, /Mais urgente/);
  assert.match(html, /Menos urgente/);
  assert.equal((html.match(/class="kanban-column tone-/g) || []).length, 4);
  assert.match(html, /Nenhuma ocorrência<br \/>nesta etapa/);
  assert.match(html, /aria-labelledby="kanban-red"/);
  assert.match(html, /<dt>Responsável<\/dt><dd>Ana<\/dd>/);
  assert.match(html, /card-detail-label">Vencimento/);
  assert.doesNotMatch(html, /class="ruler"/);
});

test('painel separa conclusões das ocorrências que ainda exigem ação', () => {
  resetState();
  STATE.obligations = [
    {
      id: 'pending', name: 'Entrega ainda pendente', category: 'federal', frequency: 'pontual',
      due_date: isoFromToday(2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
    {
      id: 'done', name: 'Entrega já concluída', category: 'estadual', frequency: 'pontual',
      due_date: isoFromToday(-2), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
      company_id: null, business_day_shift: 'nenhum',
    },
  ];
  STATE.completions = [{
    obligation_id: 'done', occurrence_date: isoFromToday(-2), done_at: `${isoFromToday(-1)}T12:00:00Z`,
    done_by_name: 'Ana', attachment_path: 'comprovantes/entrega.pdf', status: 'aprovada',
  }];

  const html = renderBoard();

  assert.match(html, /AINDA FALTA[\s\S]*Entrega ainda pendente/);
  assert.match(html, /JÁ FOI FEITO[\s\S]*Entrega já concluída/);
  assert.match(html, /completed-total"><strong>1<\/strong> conclusão/);
  assert.match(html, /Ver comprovante/);
});

test('envios em validação e devolvidos não aparecem como concluídos', () => {
  resetState();
  STATE.obligations = [{
    id: 'review', name: 'Entrega em revisão', category: 'federal', frequency: 'pontual',
    due_date: isoFromToday(-1), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
    company_id: null, business_day_shift: 'nenhum',
  }];
  STATE.completions = [
    {
      obligation_id: 'review', occurrence_date: isoFromToday(-1), done_at: `${isoFromToday(0)}T12:00:00Z`,
      done_by_name: 'Ana', status: 'aguardando_validacao',
    },
    {
      obligation_id: 'review', occurrence_date: isoFromToday(-2), done_at: `${isoFromToday(-1)}T12:00:00Z`,
      done_by_name: 'Ana', status: 'rejeitada',
    },
  ];

  const html = renderBoard();

  assert.match(html, /completed-total"><strong>0<\/strong> conclusões/);
  assert.doesNotMatch(html, /class="completed-item"/);
});

test('cada obrigação abre uma área de trabalho com o checklist oculto inicialmente', () => {
  resetState();
  STATE.obligations = [{
    id: 'open-me', name: 'Obrigação expansível', category: 'federal', frequency: 'pontual',
    due_date: isoFromToday(1), priority: 'media', responsible: 'Ana', responsible_id: 'user-1',
    company_id: null, business_day_shift: 'nenhum',
  }];
  STATE.checklistItems = [{
    id: 'step-1', obligation_id: 'open-me', description: 'Conferir documentos', completed: false,
  }];

  const html = renderBoard();

  assert.match(html, /<details class="card obligation-card">/);
  assert.match(html, /<summary class="obligation-card-summary">/);
  assert.match(html, /Abrir obrigação/);
  assert.match(html, /class="obligation-card-workspace"[\s\S]*Checklist: 0\/1/);
  assert.doesNotMatch(html, /<details class="card obligation-card" open>/);
});
