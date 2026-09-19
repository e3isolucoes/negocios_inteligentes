import { STATE, companyName } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

// "No prazo" = a pessoa concluiu no mesmo dia do vencimento (occurrence_date)
// ou antes. Comparamos só a parte de data do done_at (fuso do navegador).
function wasOnTime(completion) {
  const doneDate = new Date(completion.done_at);
  const doneKey = `${doneDate.getFullYear()}-${String(doneDate.getMonth() + 1).padStart(2, '0')}-${String(doneDate.getDate()).padStart(2, '0')}`;
  return doneKey <= completion.occurrence_date;
}

export function computeStats(completions) {
  const total = completions.length;
  const onTime = completions.filter(wasOnTime).length;
  return { total, onTime, late: total - onTime, pct: total ? Math.round((onTime / total) * 100) : null };
}

function barHtml(pct) {
  const tone = pct === null ? 'muted' : pct >= 90 ? 'green' : pct >= 70 ? 'amber' : 'red';
  const width = pct === null ? 0 : pct;
  return `<div class="report-bar"><div class="report-bar-fill tone-${tone}" style="width:${width}%"></div></div>`;
}

export function groupRow(label, stats) {
  const pctLabel = stats.pct === null ? '—' : `${stats.pct}%`;
  return '<div class="report-row">'
    + `<div class="report-label">${escapeHtml(label)}</div>`
    + barHtml(stats.pct)
    + `<div class="report-pct">${pctLabel}</div>`
    + `<div class="report-count">${stats.onTime}/${stats.total} no prazo</div>`
  + '</div>';
}

export function renderReports() {
  const obligationById = new Map(STATE.obligations.map((o) => [o.id, o]));

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);

  const recent = STATE.completions.filter((c) => c.occurrence_date >= cutoff);

  const overall = computeStats(recent);

  const byCompany = new Map();
  const byResponsible = new Map();
  recent.forEach((c) => {
    const ob = obligationById.get(c.obligation_id);
    if (!ob) return;
    const compLabel = companyName(ob.company_id) || 'Sem empresa';
    const respLabel = ob.responsible || 'Sem responsável';
    if (!byCompany.has(compLabel)) byCompany.set(compLabel, []);
    byCompany.get(compLabel).push(c);
    if (!byResponsible.has(respLabel)) byResponsible.set(respLabel, []);
    byResponsible.get(respLabel).push(c);
  });

  let html = '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Taxa de cumprimento no prazo — obrigações concluídas nos últimos 6 meses. '
    + '"No prazo" considera a conclusão registrada até a data de vencimento da ocorrência.'
    + '</div>';

  html += '<div class="report-section"><h3 class="report-heading">Geral</h3>'
    + (overall.total ? groupRow('Todas as obrigações', overall) : '<div class="empty">Sem conclusões registradas nos últimos 6 meses ainda.</div>')
    + '</div>';

  if (byCompany.size) {
    html += '<div class="report-section"><h3 class="report-heading">Por empresa</h3>'
      + Array.from(byCompany.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, list]) => groupRow(label, computeStats(list)))
        .join('')
      + '</div>';
  }

  if (byResponsible.size) {
    html += '<div class="report-section"><h3 class="report-heading">Por responsável</h3>'
      + Array.from(byResponsible.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, list]) => groupRow(label, computeStats(list)))
        .join('')
      + '</div>';
  }

  return html;
}
