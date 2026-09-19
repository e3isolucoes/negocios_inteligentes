import {
  STATE, isAdmin, isManager, canViewAllObligations, companyName, lastCompletion, activeOccurrences, checklistProgress,
} from '../state.js';
import { catInfo, moduleInfo, FREQ_LABELS, priorityInfo } from '../constants.js';
import {
  fmtBR, deltaLabel, escapeHtml, checklistProgressLabel,
} from '../dateUtils.js';

function renderAtAGlance(items, onlyMine) {
  const urgent = items.filter((it) => it.status.tone === 'red' || it.status.tone === 'amber').length;
  const overdue = items.filter((it) => it.status.tone === 'red').length;
  const unassigned = items.filter((it) => !it.ob.responsible && (it.status.tone === 'red' || it.status.tone === 'amber')).length;
  const inProgress = items.filter((it) => checklistProgress(it.ob.id)?.pct > 0 && checklistProgress(it.ob.id)?.pct < 100).length;
  const scopeLabel = onlyMine ? 'MINHAS ATIVIDADES · AGORA' : 'GESTÃO À VISTA · AGORA';
  const headline = overdue
    ? `${overdue} ocorrência${overdue === 1 ? '' : 's'} atrasada${overdue === 1 ? '' : 's'} exige${overdue === 1 ? '' : 'm'} reação imediata.`
    : urgent
      ? `${urgent} prazo${urgent === 1 ? '' : 's'} merece${urgent === 1 ? '' : 'm'} atenção nos próximos dias.`
      : 'Nenhum prazo crítico no horizonte imediato.';
  const helper = urgent
    ? 'Use os filtros para concentrar a conversa no que precisa de decisão, responsável ou evidência.'
    : 'A operação está estável; mantenha o acompanhamento dos próximos vencimentos e dos checklists.';

  return '<section class="board-brief" aria-label="Resumo operacional">'
    + `<div class="board-brief-copy"><span class="board-eyebrow">${scopeLabel}</span><h2>${headline}</h2><p>${helper}</p></div>`
    + '<div class="board-brief-metrics">'
      + `<div class="brief-metric tone-${urgent ? 'amber' : 'green'}"><strong>${urgent}</strong><span>prazos prioritários</span></div>`
      + `<div class="brief-metric tone-${inProgress ? 'accent' : 'muted'}"><strong>${inProgress}</strong><span>checklists em andamento</span></div>`
      + `<div class="brief-metric tone-${unassigned ? 'red' : 'green'}"><strong>${unassigned}</strong><span>urgentes sem responsável</span></div>`
      + `<div class="brief-metric tone-muted"><strong>${items.length}</strong><span>ocorrências acompanhadas</span></div>`
    + '</div>'
  + '</section>';
}

export function renderStats(items) {
  const counts = { red: 0, amber: 0, green: 0, muted: 0 };
  items.forEach((it) => { counts[it.status.tone]++; });
  const cfg = [
    ['red', 'Atrasadas'], ['amber', 'Vencem em breve'], ['green', 'No prazo'], ['muted', 'Sem pendência'],
  ];
  return `<section class="stats">${cfg.map(([tone, label]) => (
    `<div class="stat tone-${tone}"><div class="n">${counts[tone]}</div><div class="l">${label}</div></div>`
  )).join('')}</section>`;
}

function renderCard(it) {
  const {
    ob, active, displayDate, override, status: st,
  } = it;
  const cat = catInfo(ob.category);
  const module = moduleInfo(ob.module_key || 'fiscal');
  const dueLabel = displayDate ? fmtBR(displayDate) : '—';
  const deltaTxt = displayDate ? deltaLabel(st.diffDays) : 'sem ocorrência prevista';
  const deadlineHtml = '<div class="card-deadline">'
    + '<div><span class="card-detail-label">Vencimento</span>'
      + `<strong class="due-date">${dueLabel}</strong></div>`
    + `<span class="due-delta tone-${st.tone}">${deltaTxt}</span>`
  + '</div>';
  const overrideNote = override
    ? `<div class="card-meta" style="color:var(--amber);">📌 Data ajustada manualmente (padrão seria ${fmtBR(active)})${override.reason ? ` — ${escapeHtml(override.reason)}` : ''}</div>`
    : '';

  const last = lastCompletion(ob.id);
  const checklistLabel = checklistProgressLabel(last);
  const completionLabel = last?.status === 'aguardando_validacao'
    ? '⏳ Enviada para validação'
    : (last?.status === 'rejeitada' ? '↩ Devolvida para correção' : '✓ Última conclusão');
  const lastCompletionHtml = last
    ? `<div class="card-last-completion">${completionLabel}: <strong>${escapeHtml(last.done_by_name)}</strong> em ${fmtBR(new Date(last.done_at))}${last.attachment_path ? ` · <button type="button" class="comment-delete" data-action="view-attachment" data-path="${escapeHtml(last.attachment_path)}">ver comprovante</button>` : ''}${checklistLabel ? ` · ${checklistLabel}` : ''}</div>`
    : '';

  // Checklist do ciclo ATUAL (ainda não concluído), com progresso ao vivo.
  // Ele fica dentro da área de trabalho expansível para manter o painel
  // legível e só expor as tarefas quando alguém abrir a obrigação.
  const progress = active ? checklistProgress(ob.id) : null;
  const liveChecklistHtml = progress ? '<div class="card-checklist">'
    + `<div class="card-checklist-head">Checklist: ${progress.checked}/${progress.total} (${progress.pct}%)</div>`
    + `<div class="report-bar"><div class="report-bar-fill tone-${progress.pct === 100 ? 'green' : 'amber'}" style="width:${progress.pct}%"></div></div>`
    + '<div class="card-checklist-items">'
      + progress.items.map((i) => (
        `<label class="checklist-complete-item"><input type="checkbox" data-action="checklist-toggle" data-id="${i.id}" data-done="${!i.completed}" ${i.completed ? 'checked' : ''} /> ${escapeHtml(i.description)}</label>`
      )).join('')
    + '</div>'
  + '</div>' : '';

  let actionsHtml = '<div class="card-actions">';
  if (active) {
    actionsHtml += `<button class="btn-sm done" data-action="done" data-id="${ob.id}">✓ Marcar concluído</button>`;
  } else {
    actionsHtml += '<button class="btn-sm" disabled>Sem pendência ativa</button>';
  }
  if (isManager()) {
    actionsHtml += `<button class="btn-sm edit" data-action="edit" data-id="${ob.id}">Editar</button>`;
  }
  actionsHtml += '</div>';

  return '<details class="card obligation-card">'
    + '<summary class="obligation-card-summary">'
    + '<div class="card-top">'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
        + `<span class="badge" style="border-color:${module.color};color:${module.color};">${module.label}</span>`
        + `${ob.activity_type === 'obrigacao_acessoria' || !ob.activity_type ? `<span class="badge" style="border-color:${cat.color};color:${cat.color};">${cat.label}</span>` : ''}`
        + (ob.priority === 'critica' || ob.priority === 'alta' ? `<span class="badge" style="border-color:var(--red);color:var(--red);" title="Prioridade ${priorityInfo(ob.priority).label}">${ob.priority === 'critica' ? '🔥 Crítica' : '⚠ Alta'}</span>` : '')
      + '</div>'
      + `<span class="status-pill tone-${st.tone}">${st.label}</span>`
    + '</div>'
    + `<h3 class="card-title">${escapeHtml(ob.name)}</h3>`
    + deadlineHtml
    + '<span class="card-open-label"><span class="when-closed">Abrir obrigação</span><span class="when-open">Fechar obrigação</span><span aria-hidden="true">⌄</span></span>'
    + '</summary>'
    + '<div class="obligation-card-workspace">'
    + '<dl class="card-details">'
      + `<div><dt>Empresa</dt><dd>${escapeHtml(companyName(ob.company_id) || 'Não informada')}</dd></div>`
      + `<div><dt>Responsável</dt><dd>${escapeHtml(ob.responsible || 'Não definido')}</dd></div>`
      + `<div><dt>Frequência</dt><dd>${FREQ_LABELS[ob.frequency]}</dd></div>`
      + `<div><dt>Tipo</dt><dd>${ob.activity_type === 'obrigacao_acessoria' || !ob.activity_type ? 'Obrigação acessória' : escapeHtml(ob.activity_type)}</dd></div>`
      + `<div><dt>Processo / área</dt><dd>${escapeHtml(ob.process_name || 'Não informado')} · ${escapeHtml(ob.area_name || 'Não informada')}</dd></div>`
    + '</dl>'
    + overrideNote
    + liveChecklistHtml
    + lastCompletionHtml
    + actionsHtml
    + '</div></details>';
}

function filteredCompletionHistory({ onlyMine = false } = {}) {
  const restrictToCurrentUser = onlyMine && !canViewAllObligations();
  const obligationsById = new Map(STATE.obligations.map((ob) => [ob.id, ob]));

  return STATE.completions
    .filter((completion) => !['rejeitada', 'aguardando_validacao'].includes(completion.status))
    .map((completion) => ({ completion, ob: obligationsById.get(completion.obligation_id) }))
    .filter(({ completion, ob }) => {
      if (!ob) return false;
      if (STATE.activeModule !== 'all' && (ob.module_key || 'fiscal') !== STATE.activeModule) return false;
      if (restrictToCurrentUser && ob.responsible_id !== STATE.session?.id) return false;
      if (STATE.filters.empresa !== 'all' && ob.company_id !== STATE.filters.empresa) return false;
      if (STATE.filters.category !== 'all' && ob.category !== STATE.filters.category) return false;
      if (STATE.filters.responsible !== 'all' && ob.responsible !== STATE.filters.responsible) return false;
      if (STATE.filters.receipt === 'missing' && completion.attachment_path) return false;
      return true;
    })
    .sort((a, b) => {
      const completedB = String(b.completion.done_at || b.completion.created_at || '');
      const completedA = String(a.completion.done_at || a.completion.created_at || '');
      return completedB.localeCompare(completedA);
    });
}

function renderCompleted(items) {
  const visible = items.slice(0, 12);
  const list = visible.length
    ? `<div class="completed-list">${visible.map(({ completion, ob }) => {
      const cat = catInfo(ob.category);
      const receipt = completion.attachment_path
        ? `<button type="button" class="comment-delete" data-action="view-attachment" data-path="${escapeHtml(completion.attachment_path)}">Ver comprovante</button>`
        : '<span class="completed-no-receipt">Sem comprovante</span>';
      return '<article class="completed-item">'
        + `<span class="completed-check" aria-hidden="true">✓</span><div class="completed-main"><div class="completed-title"><strong>${escapeHtml(ob.name)}</strong><span class="badge" style="border-color:${cat.color};color:${cat.color};">${cat.label}</span></div>`
        + `<p>${escapeHtml(companyName(ob.company_id) || 'Empresa não informada')} · competência ${fmtBR(new Date(`${completion.occurrence_date}T00:00:00`))}</p></div>`
        + `<div class="completed-meta"><strong>${fmtBR(new Date(completion.done_at))}</strong><span>por ${escapeHtml(completion.done_by_name || 'Não informado')}</span>${receipt}</div>`
        + '</article>';
    }).join('')}</div>`
    : '<div class="completed-empty">Nenhuma conclusão encontrada para os filtros atuais.</div>';

  const remainder = items.length > visible.length
    ? `<p class="completed-remainder">Mostrando as 12 mais recentes de ${items.length} conclusões.</p>` : '';

  return '<section class="completed-section" aria-labelledby="completed-heading">'
    + '<div class="completed-heading"><div><span class="board-eyebrow">JÁ FOI FEITO</span><h2 id="completed-heading">Concluídas recentemente</h2><p>Histórico separado das pendências para facilitar a conferência do trabalho entregue.</p></div>'
    + `<span class="completed-total"><strong>${items.length}</strong> ${items.length === 1 ? 'conclusão' : 'conclusões'}</span></div>`
    + list + remainder + '</section>';
}

export function renderBoard({ onlyMine = false } = {}) {
  // A visão da Gestão é sempre a carteira completa. Além de evitar que um
  // gestor fique preso ao recorte pessoal ao trocar de papel com a aba
  // "Minhas obrigações" aberta, isso garante que itens sem responsável ou
  // atribuídos a outra pessoa continuem visíveis para acompanhamento.
  const restrictToCurrentUser = onlyMine && !canViewAllObligations();
  const items = activeOccurrences().filter((it) => {
    const last = lastCompletion(it.ob.id);
    // Uma obrigação pontual já entregue pertence ao histórico, não à coluna
    // "Sem pendência". Envios aguardando validação continuam no fluxo aberto.
    if (!it.active && last && !['rejeitada', 'aguardando_validacao'].includes(last.status)) return false;
    if (restrictToCurrentUser && it.ob.responsible_id !== STATE.session?.id) return false;
    if (STATE.activeModule !== 'all' && (it.ob.module_key || 'fiscal') !== STATE.activeModule) return false;
    if (STATE.filters.empresa !== 'all' && it.ob.company_id !== STATE.filters.empresa) return false;
    if (STATE.filters.category !== 'all' && it.ob.category !== STATE.filters.category) return false;
    if (STATE.filters.responsible !== 'all' && it.ob.responsible !== STATE.filters.responsible) return false;
    if (STATE.filters.status === 'today' && it.status.diffDays !== 0) return false;
    if (STATE.filters.status !== 'all' && STATE.filters.status !== 'today' && it.status.tone !== STATE.filters.status) return false;
    if (STATE.filters.receipt === 'missing' && lastCompletion(it.ob.id)?.attachment_path) return false;
    return true;
  });

  const overviewHtml = renderAtAGlance(items, restrictToCurrentUser);
  const statsHtml = renderStats(items);
  const completedHtml = STATE.filters.status === 'all'
    ? renderCompleted(filteredCompletionHistory({ onlyMine })) : '';

  if (!items.length) {
    const emptyMsg = restrictToCurrentUser
      ? 'Nenhuma obrigação está vinculada a você no momento. Peça a um administrador para te definir como responsável em alguma obrigação (aba Gerenciar → Obrigações).'
      : 'Nenhuma obrigação corresponde a este filtro. Ajuste os filtros acima ou cadastre uma nova obrigação.';
    return `${overviewHtml}${statsHtml}<section class="pending-empty"><span class="board-eyebrow">AINDA FALTA</span><div class="empty">${emptyMsg}</div></section>${completedHtml}`;
  }

  const groups = [
    { tone: 'red', title: 'Atrasadas', hint: 'Ação imediata' },
    { tone: 'amber', title: 'Vencem em breve', hint: 'Até 5 dias' },
    { tone: 'green', title: 'No prazo', hint: 'Planeje a execução' },
    { tone: 'muted', title: 'Sem pendência', hint: 'Nada próximo' },
  ];

  let html = overviewHtml + statsHtml
    + '<section class="kanban" aria-label="Kanban de prazos">'
    + '<div class="kanban-heading">'
      + '<div><span class="board-eyebrow">AINDA FALTA</span><h2>Pendências por prioridade</h2></div>'
      + '<p>Aqui ficam somente as ocorrências que ainda exigem acompanhamento. Comece pelas atrasadas.</p>'
    + '</div>'
    + '<div class="kanban-guide" aria-label="Ordem de prioridade"><strong>Mais urgente</strong><span aria-hidden="true"></span><strong>Menos urgente</strong></div>'
    + '<div class="kanban-columns">';
  groups.forEach((g) => {
    const groupItems = items
      .filter((it) => it.status.tone === g.tone)
      .sort((a, b) => {
        const da = a.displayDate ? a.displayDate.getTime() : Infinity;
        const db = b.displayDate ? b.displayDate.getTime() : Infinity;
        return da - db;
      });
    html += `<section class="kanban-column tone-${g.tone}" aria-labelledby="kanban-${g.tone}">`
      + '<header class="kanban-column-head">'
        + '<div class="kanban-column-title-row">'
          + `<div class="kanban-column-title"><span class="group-dot tone-${g.tone}" aria-hidden="true"></span><div class="kanban-column-copy"><h3 id="kanban-${g.tone}">${g.title}</h3><small class="kanban-column-hint">${g.hint}</small></div></div>`
          + `<span class="kanban-count" aria-label="${groupItems.length} ocorrência${groupItems.length === 1 ? '' : 's'}">${groupItems.length}</span>`
        + '</div>'
      + '</header>'
      + `<div class="kanban-cards">${groupItems.length ? groupItems.map(renderCard).join('') : '<div class="kanban-empty">Nenhuma ocorrência<br />nesta etapa</div>'}</div>`
      + '</section>';
  });
  return `${html}</div></section>${completedHtml}`;
}
