import {
  STATE, companyName, lastCompletion, activeOccurrences, checklistProgress,
} from '../state.js';
import { catInfo, FREQ_LABELS, priorityInfo } from '../constants.js';
import {
  freqSummary, escapeHtml, fmtBR, checklistProgressLabel, deltaLabel, businessDayShiftShortLabel,
} from '../dateUtils.js';

function renderControlSummary(activeItems) {
  const overdue = activeItems.filter((it) => it.status.tone === 'red').length;
  const dueSoon = activeItems.filter((it) => it.status.tone === 'amber').length;
  const unassigned = activeItems.filter((it) => !it.ob.responsible && (it.status.tone === 'red' || it.status.tone === 'amber')).length;
  const withChecklist = activeItems.filter((it) => checklistProgress(it.ob.id)).length;

  return '<section class="mgmt-control-brief" aria-label="Resumo do controle de atividades">'
    + '<div class="mgmt-control-copy"><span class="board-eyebrow">CONTROLE DE ATIVIDADES · CARTEIRA</span><h2>Processos conectados, exceções em evidência.</h2><p>Organize tipos, áreas e dependências para formar uma esteira eficiente, sem perder responsáveis e prazos.</p></div>'
    + '<div class="mgmt-control-metrics">'
      + `<div class="mgmt-control-metric tone-red"><strong>${overdue}</strong><span>atrasadas</span></div>`
      + `<div class="mgmt-control-metric tone-amber"><strong>${dueSoon}</strong><span>vencem em breve</span></div>`
      + `<div class="mgmt-control-metric ${unassigned ? 'tone-red' : 'tone-green'}"><strong>${unassigned}</strong><span>urgentes sem dono</span></div>`
      + `<div class="mgmt-control-metric tone-accent"><strong>${withChecklist}</strong><span>com checklist</span></div>`
    + '</div>'
  + '</section>';
}

export function renderObligationsManage() {
  if (!STATE.obligations.length) {
    return '<div class="empty">Nenhuma atividade cadastrada ainda. Use "+ Nova atividade" para começar a esteira do seu grupo.</div>';
  }

  const activeByObligationId = new Map(activeOccurrences().map((it) => [it.ob.id, it]));

  const toneRank = { red: 0, amber: 1, green: 2, muted: 3 };
  const list = STATE.obligations.slice().sort((a, b) => {
    const aItem = activeByObligationId.get(a.id);
    const bItem = activeByObligationId.get(b.id);
    const byTone = (toneRank[aItem?.status.tone] ?? 4) - (toneRank[bItem?.status.tone] ?? 4);
    if (byTone !== 0) return byTone;
    const aDate = aItem?.displayDate?.getTime() ?? Infinity;
    const bDate = bItem?.displayDate?.getTime() ?? Infinity;
    if (aDate !== bDate) return aDate - bDate;
    return a.name.localeCompare(b.name);
  });
  return renderControlSummary(Array.from(activeByObligationId.values())) + list.map((ob) => {
    const cat = catInfo(ob.category);
    const prio = priorityInfo(ob.priority);
    const last = lastCompletion(ob.id);
    const checklistLabel = checklistProgressLabel(last);
    const lastLine = last
      ? `Última conclusão: <strong>${escapeHtml(last.done_by_name)}</strong> em ${fmtBR(new Date(last.done_at))}${last.attachment_path ? ` · <button type="button" class="comment-delete" data-action="view-attachment" data-path="${escapeHtml(last.attachment_path)}">ver comprovante</button>` : ' · sem comprovante (registro antigo)'}${checklistLabel ? ` · ${checklistLabel}` : ''}`
      : 'Nenhuma conclusão registrada ainda';

    const active = activeByObligationId.get(ob.id);
    const nextLine = active?.displayDate
      ? `<span class="status-pill tone-${active.status.tone}">${escapeHtml(active.status.label)}</span> Próximo vencimento: <strong>${fmtBR(active.displayDate)}</strong> (${deltaLabel(active.status.diffDays)})${active.override ? ' · 📌 data ajustada manualmente' : ''}`
      : 'Sem próxima ocorrência prevista';

    const progress = active?.active ? checklistProgress(ob.id) : null;
    const progressLine = progress
      ? `<div class="mgmt-sub">Checklist do ciclo atual: <strong>${progress.checked}/${progress.total} (${progress.pct}%)</strong></div>`
      : '';

    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(ob.name)} <span class="badge" style="border-color:${cat.color};color:${cat.color};">${cat.label}</span>${ob.priority && ob.priority !== 'media' ? ` <span class="badge" style="border-color:var(--ink-soft);color:var(--ink-soft);">Prioridade: ${prio.label}</span>` : ''}</div>`
        + `<div class="mgmt-sub">🏢 ${escapeHtml(companyName(ob.company_id) || '—')} · ${FREQ_LABELS[ob.frequency]} · ${escapeHtml(freqSummary(ob))}${businessDayShiftShortLabel(ob.business_day_shift) ? ` · ${businessDayShiftShortLabel(ob.business_day_shift)}` : ''} · Responsável: ${escapeHtml(ob.responsible || '—')}</div>`
        + `<div class="mgmt-sub">Esteira: ${escapeHtml(ob.process_name || 'processo não informado')} · ${escapeHtml(ob.area_name || 'área não informada')} · ${ob.activity_type === 'obrigacao_acessoria' || !ob.activity_type ? 'obrigação acessória' : escapeHtml(ob.activity_type)}</div>`
        + `<div class="mgmt-sub">${nextLine}</div>`
        + progressLine
        + `<div class="mgmt-sub">${lastLine}</div>`
      + '</div>'
      + '<div class="mgmt-actions">'
        + `<button class="icon-btn" data-action="edit" data-id="${ob.id}">Editar</button>`
        + (active?.active ? `<button class="icon-btn" data-action="occurrence-adjust" data-id="${ob.id}">🗓 Ajustar data</button>` : '')
        + `<button class="icon-btn" data-action="undo" data-id="${ob.id}">↺ Desfazer conclusão</button>`
        + `<button class="icon-btn danger" data-action="delete" data-id="${ob.id}">Excluir</button>`
      + '</div>'
      + '</div>';
  }).join('');
}
