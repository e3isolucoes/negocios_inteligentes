import {
  STATE, isManager, companyName, activeOccurrences, checklistProgress,
} from '../state.js';
import { catInfo, moduleInfo, priorityInfo } from '../constants.js';
import {
  escapeHtml, fmtBR, deltaLabel, fmtKey,
} from '../dateUtils.js';
import { renderStats } from './board.js';
import { computeStats, groupRow } from './reports.js';
import { trainDelayRiskModel } from '../riskModel.js';
import { renderExecutiveView } from './executiveView.js';
import { ReguaFechamento } from './ReguaFechamento.js';

function recentCompletions() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);
  return STATE.completions.filter((c) => c.occurrence_date >= cutoff);
}

function kpiSection(items) {
  const overall = computeStats(recentCompletions());
  const counts = toneCounts(items);
  const health = items.length ? Math.round(((counts.green + counts.muted) / items.length) * 100) : 100;
  const healthTone = health >= 85 ? 'green' : health >= 65 ? 'amber' : 'red';
  const urgent = counts.red + counts.amber;
  const narrative = urgent
    ? `<strong>${urgent} obrigação(ões) exigem atenção</strong>, sendo ${counts.red} já atrasada(s). Priorize a recuperação antes de absorver novos riscos.`
    : '<strong>Operação sob controle.</strong> Não há vencimentos críticos no horizonte atual; preserve o ritmo e monitore os próximos picos.';

  return '<section class="dashboard-opening">'
    + '<div class="dashboard-eyebrow">SAÚDE DA OPERAÇÃO · AGORA</div>'
    + '<div class="dashboard-hero">'
      + '<div class="health-score">'
        + `<div class="health-ring tone-${healthTone}" style="--score:${health}" role="img" aria-label="Índice de saúde ${health} de 100"><div><strong>${health}</strong><span>/100</span></div></div>`
        + '<div><span class="health-label">Índice de saúde</span><p>Percentual da carteira sem atraso ou alerta imediato.</p></div>'
      + '</div>'
      + `<div class="dashboard-narrative"><span>Leitura executiva</span><p>${narrative}</p><small>Atualizado a partir de ${items.length} ocorrência(s) ativa(s).</small></div>`
    + '</div>'
    + renderStats(items)
    + `<div class="benchmark-line"><span>Desempenho em 6 meses</span><strong>${overall.pct === null ? 'Sem base histórica' : `${overall.pct}% no prazo`}</strong><span>${overall.total} conclusão(ões) analisada(s)</span></div>`
    + '</section>';
}

function actionSection(items) {
  const overdue = items.filter((it) => it.status.tone === 'red');
  const dueSoon = items.filter((it) => it.status.tone === 'amber');
  const critical = overdue.filter((it) => it.ob.priority === 'critica' || it.ob.priority === 'alta');
  const unassigned = items.filter((it) => !it.ob.responsible && (it.status.tone === 'red' || it.status.tone === 'amber'));
  const actions = [];

  if (critical.length) actions.push({ tone: 'red', tag: 'AÇÃO IMEDIATA', title: `Recuperar ${critical.length} item(ns) crítico(s)`, text: 'Alinhe responsável e novo compromisso ainda hoje.', cta: 'Ver lista de risco', target: 'risk-register' });
  if (unassigned.length) actions.push({ tone: 'amber', tag: 'DEFINIR DONO', title: `Atribuir ${unassigned.length} pendência(s)`, text: 'Itens urgentes sem responsável aumentam o risco operacional.', cta: 'Ver responsáveis', target: 'tactical-owner' });
  if (dueSoon.length) actions.push({ tone: 'amber', tag: 'PRÓXIMOS 7 DIAS', title: `Proteger ${dueSoon.length} vencimento(s)`, text: 'Confirme documentos e capacidade antes do prazo apertar.', cta: 'Ver riscos', target: 'risk-register' });
  if (!actions.length) actions.push({ tone: 'green', tag: 'MANTER RITMO', title: 'Nenhuma ação corretiva agora', text: 'Revise os sinais preditivos e prepare os próximos vencimentos.', cta: 'Ver predições', target: 'predictive-risk' });

  return '<section class="dashboard-section"><div class="section-title-row"><div><span class="dashboard-eyebrow">DA LEITURA À DECISÃO</span><h2>O que fazer agora</h2></div><p>Recomendações priorizadas por urgência e impacto.</p></div>'
    + `<div class="action-grid">${actions.slice(0, 3).map((a, index) => `<article class="action-card tone-${a.tone}"><div class="action-order">0${index + 1}</div><div><span class="action-tag">${a.tag}</span><h3>${a.title}</h3><p>${a.text}</p><a href="#${a.target}">${a.cta} →</a></div></article>`).join('')}</div></section>`;
}

// Traduz a carteira de atividades em uma leitura empresarial: cada categoria
// representa uma frente de gestão e conserva o cadastro já usado pela empresa.
// Categorias fiscais e categorias administrativas convivem no mesmo fluxo,
// portanto nenhuma atividade histórica precisa ser migrada ou recriada.
function managementMapSection(items) {
  const areas = new Map();
  items.forEach((item) => {
    const module = moduleInfo(item.ob.module_key || 'fiscal');
    const area = areas.get(module.key) || {
      key: module.key, label: module.label, color: module.color, total: 0, urgent: 0,
      unassigned: 0, progress: 0, tracked: 0,
    };
    const checklist = checklistProgress(item.ob.id);
    area.total++;
    if (item.status.tone === 'red' || item.status.tone === 'amber') area.urgent++;
    if (!item.ob.responsible) area.unassigned++;
    if (checklist) {
      area.progress += checklist.pct;
      area.tracked++;
    }
    areas.set(module.key, area);
  });

  const cards = Array.from(areas.values())
    .sort((a, b) => b.urgent - a.urgent || b.total - a.total || a.label.localeCompare(b.label))
    .map((area) => {
      const average = area.tracked ? Math.round(area.progress / area.tracked) : 0;
      const tone = area.urgent ? 'red' : 'green';
      return `<button type="button" class="management-area-card" style="--area-color:${escapeHtml(area.color)}" data-action="module" data-module="${area.key}">`
        + `<div class="management-area-heading"><span class="management-area-dot" aria-hidden="true"></span><h3>${escapeHtml(area.label)}</h3><strong>${area.total}</strong></div>`
        + `<p><span class="status-pill tone-${tone}">${area.urgent ? `${area.urgent} em atenção` : 'Sob controle'}</span>${area.unassigned ? `<span>${area.unassigned} sem responsável</span>` : '<span>Responsáveis definidos</span>'}</p>`
        + `<div class="owner-progress-track" role="progressbar" aria-label="Avanço médio de ${escapeHtml(area.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${average}"><span style="width:${average}%"></span></div>`
        + `<small>${area.tracked ? `${average}% de avanço médio · ${area.tracked} com checklist` : 'Adicione checklists para medir o avanço'}</small>`
      + '</button>';
    }).join('');

  return '<section class="dashboard-section" id="management-map">'
    + '<div class="section-title-row"><div><span class="dashboard-eyebrow">VISÃO 360° DA EMPRESA</span><h2>Mapa das áreas de gestão</h2></div><p>Volume, pontos de atenção, responsáveis e execução por frente administrativa.</p></div>'
    + `<div class="management-area-grid">${cards || '<div class="empty">Cadastre a primeira atividade para iniciar o acompanhamento das áreas.</div>'}</div>`
  + '</section>';
}

function executionSection(items) {
  const enriched = items.map((item) => ({ ...item, progress: checklistProgress(item.ob.id) }));
  const attention = enriched.filter((item) => item.status.tone === 'red' || item.status.tone === 'amber');
  const inProgress = enriched.filter((item) => item.progress && item.progress.pct > 0 && item.progress.pct < 100);
  const ready = enriched.filter((item) => item.progress?.pct === 100);
  const notStarted = enriched.filter((item) => !item.progress || item.progress.pct === 0);
  const tracked = enriched.filter((item) => item.progress);
  const average = tracked.length
    ? Math.round(tracked.reduce((sum, item) => sum + item.progress.pct, 0) / tracked.length)
    : 0;
  const cards = [
    { label: 'Em atenção', value: attention.length, note: 'atrasadas ou próximas do prazo', tone: attention.length ? 'red' : 'green' },
    { label: 'Em andamento', value: inProgress.length, note: 'com checklist iniciado', tone: 'accent' },
    { label: 'Prontas para concluir', value: ready.length, note: 'checklist 100% preenchido', tone: 'green' },
    { label: 'A iniciar', value: notStarted.length, note: 'sem etapa marcada', tone: notStarted.length ? 'muted' : 'green' },
  ];

  const ownerGroups = new Map();
  enriched.forEach((item) => {
    const owner = item.ob.responsible || 'Sem responsável';
    const current = ownerGroups.get(owner) || { total: 0, attention: 0, progressTotal: 0, tracked: 0 };
    current.total++;
    if (item.status.tone === 'red' || item.status.tone === 'amber') current.attention++;
    if (item.progress) {
      current.progressTotal += item.progress.pct;
      current.tracked++;
    }
    ownerGroups.set(owner, current);
  });
  const owners = Array.from(ownerGroups.entries())
    .sort((a, b) => b[1].attention - a[1].attention || b[1].total - a[1].total)
    .slice(0, 6);

  const ownerRows = owners.map(([owner, data]) => {
    const pct = data.tracked ? Math.round(data.progressTotal / data.tracked) : 0;
    const attentionLabel = data.attention ? `${data.attention} em atenção` : 'sem alertas';
    return '<div class="owner-progress-row">'
      + `<div class="owner-progress-heading"><strong>${escapeHtml(owner)}</strong><span>${data.total} item(ns) · ${attentionLabel}</span></div>`
      + `<div class="owner-progress-track" role="progressbar" aria-label="Andamento de ${escapeHtml(owner)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`
      + `<small>${data.tracked ? `${pct}% médio dos checklists` : 'Sem checklist para medir avanço'}</small>`
    + '</div>';
  }).join('');

  return '<section class="dashboard-section execution-overview" id="execution-overview">'
    + '<div class="section-title-row"><div><span class="dashboard-eyebrow">GESTÃO À VISTA</span><h2>Andamento da carteira</h2></div><p>Etapa atual, avanço dos checklists e carga por responsável.</p></div>'
    + `<div class="execution-summary"><div class="portfolio-progress"><div><span>Avanço médio</span><strong>${average}%</strong></div><div class="portfolio-progress-track" role="progressbar" aria-label="Avanço médio da carteira" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${average}"><span style="width:${average}%"></span></div><small>${tracked.length} de ${items.length} ocorrência(s) possuem checklist mensurável</small></div>`
    + `<div class="execution-stage-grid">${cards.map((card) => `<article class="execution-stage tone-${card.tone}"><span>${card.label}</span><strong>${card.value}</strong><small>${card.note}</small></article>`).join('')}</div></div>`
    + `<div class="owner-progress"><div class="owner-progress-title"><h3>Ritmo por responsável</h3><span>Ordenado pelos pontos de atenção</span></div>${ownerRows || '<div class="empty">Nenhum responsável com ocorrência ativa.</div>'}</div>`
  + '</section>';
}

function riskSection(items) {
  const risky = items
    .filter((it) => (it.ob.priority === 'alta' || it.ob.priority === 'critica') && (it.status.tone === 'red' || it.status.tone === 'amber'))
    .sort((a, b) => {
      const da = a.displayDate ? a.displayDate.getTime() : Infinity;
      const db = b.displayDate ? b.displayDate.getTime() : Infinity;
      return da - db;
    });

  if (!risky.length) {
    return '<div class="report-section" id="risk-register"><h3 class="report-heading">Lista de risco (prioridade alta/crítica)</h3>'
      + '<div class="empty">Nenhuma obrigação de prioridade alta ou crítica está atrasada ou vencendo em breve.</div></div>';
  }

  const rows = risky.map(({
    ob, displayDate, override, status,
  }) => {
    const prio = priorityInfo(ob.priority);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(ob.name)} <span class="badge" style="border-color:var(--red);color:var(--red);">${escapeHtml(prio.label)}</span> <span class="status-pill tone-${status.tone}">${escapeHtml(status.label)}</span></div>`
        + `<div class="mgmt-sub">🏢 ${escapeHtml(companyName(ob.company_id) || '—')} · 👤 ${escapeHtml(ob.responsible || '—')} · vencimento ${displayDate ? fmtBR(displayDate) : '—'} (${deltaLabel(status.diffDays)})${override ? ' · 📌 data ajustada' : ''}</div>`
      + '</div>'
    + '</div>';
  }).join('');

  return `<div class="report-section" id="risk-register"><h3 class="report-heading">Lista de risco (prioridade alta/crítica) — ${risky.length}</h3>${rows}</div>`;
}

// Usa um modelo leve treinado no próprio navegador. Ele combina o histórico da
// obrigação, empresa, categoria e responsável e suaviza amostras pequenas.
// Assim, a previsão ajuda a priorizar sem apresentar palpite como certeza.
function predictiveRiskSection(items) {
  const model = trainDelayRiskModel(STATE.obligations, STATE.completions);
  const candidates = items
    .filter((it) => it.status.tone === 'green' || it.status.tone === 'muted')
    .map((it) => ({ it, prediction: model.predict(it.ob) }))
    .filter((entry) => entry.prediction && entry.prediction.level !== 'low')
    .sort((a, b) => b.prediction.probability - a.prediction.probability)
    .slice(0, 10);

  const intro = `<div class="smart-explainer"><strong>Como funciona:</strong> o painel aprende com ${model.sampleSize} conclusão(ões) anteriores e procura padrões parecidos por obrigação, empresa, categoria e responsável. A previsão é uma ajuda para organizar o trabalho, não uma certeza.</div>`;

  if (!model.ready) {
    return '<div class="report-section" id="predictive-risk"><h3 class="report-heading">Previsão de possíveis atrasos</h3>'
      + intro + '<div class="empty">Ainda não há histórico suficiente. Registre pelo menos 5 conclusões para o painel começar a aprender.</div></div>';
  }
  if (!candidates.length) {
    return '<div class="report-section" id="predictive-risk"><h3 class="report-heading">Previsão de possíveis atrasos</h3>'
      + intro + '<div class="empty">Nenhuma obrigação no prazo precisa de atenção extra neste momento.</div></div>';
  }

  const rows = candidates.map(({ it, prediction }) => {
    const tone = prediction.level === 'high' ? 'red' : 'amber';
    const label = prediction.level === 'high' ? 'Atenção alta' : 'Atenção moderada';
    return '<div class="mgmt-row"><div class="mgmt-main">'
      + `<div class="mgmt-name">${escapeHtml(it.ob.name)} <span class="status-pill tone-${tone}">${label}</span></div>`
      + `<div class="mgmt-sub">Chance estimada de atraso: <strong>${prediction.probability}%</strong> · Motivo: ${escapeHtml(prediction.reason)}. Vencimento: ${it.displayDate ? fmtBR(it.displayDate) : '—'}.</div>`
      + '</div></div>';
  }).join('');

  return `<div class="report-section" id="predictive-risk"><h3 class="report-heading">Previsão de possíveis atrasos — ${candidates.length}</h3>${intro}${rows}</div>`;
}

// Conclusões cujo comprovante foi lido por OCR e pareceu ser de uma
// competência diferente da ocorrência concluída (ver js/ocr.js) — a pessoa
// já viu o aviso na hora e confirmou mesmo assim, mas o gestor também
// precisa saber, sem depender só do e-mail diário.
function ocrMismatchSection() {
  const obligationById = new Map(STATE.obligations.map((o) => [o.id, o]));
  const mismatches = STATE.completions
    .filter((c) => c.ocr_status === 'mismatch')
    .sort((a, b) => b.done_at.localeCompare(a.done_at))
    .slice(0, 20);

  if (!mismatches.length) {
    return '<div class="report-section"><h3 class="report-heading">Divergências de comprovante (competência)</h3>'
      + '<div class="empty">Nenhuma divergência de competência sinalizada pela conferência automática de comprovantes.</div></div>';
  }

  const rows = mismatches.map((c) => {
    const ob = obligationById.get(c.obligation_id);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(ob?.name || 'Obrigação removida')} <span class="status-pill tone-amber">Divergência</span></div>`
        + `<div class="mgmt-sub">Comprovante da competência ${escapeHtml(c.ocr_extracted_period || '—')} · ocorrência ${escapeHtml(c.occurrence_date)} · concluído por <strong>${escapeHtml(c.done_by_name)}</strong> em ${fmtBR(new Date(c.done_at))}${c.attachment_path ? ` · <button type="button" class="comment-delete" data-action="view-attachment" data-path="${escapeHtml(c.attachment_path)}">ver comprovante</button>` : ''}</div>`
      + '</div>'
    + '</div>';
  }).join('');

  return `<div class="report-section"><h3 class="report-heading">Divergências de comprovante (competência) — ${mismatches.length}</h3>${rows}</div>`;
}

function toneCounts(list) {
  const counts = { red: 0, amber: 0, green: 0, muted: 0 };
  list.forEach((it) => { counts[it.status.tone]++; });
  return counts;
}

function tacticalRow(label, groupItems, completionsForGroup) {
  const counts = toneCounts(groupItems);
  const stats = computeStats(completionsForGroup);
  const pctLabel = stats.pct === null ? '—' : `${stats.pct}%`;
  return '<div class="mgmt-row">'
    + '<div class="mgmt-main">'
      + `<div class="mgmt-name">${escapeHtml(label)}</div>`
      + `<div class="mgmt-sub">🔴 ${counts.red} atrasada(s) · 🟠 ${counts.amber} vence(m) em breve · 🟢 ${counts.green} no prazo · ⚪ ${counts.muted} sem pendência · cumprimento (6m): ${pctLabel}</div>`
    + '</div>'
  + '</div>';
}

// Agrupa `items` (situação atual) e `completions` (histórico de 6 meses) pela
// mesma chave, para renderizar uma tabela tática por dimensão (empresa,
// categoria ou responsável) sem repetir esse acoplamento três vezes.
function tacticalTable(heading, items, completions, keyFn) {
  const obligationById = new Map(STATE.obligations.map((o) => [o.id, o]));

  const itemsByKey = new Map();
  items.forEach((it) => {
    const key = keyFn(it.ob);
    if (!itemsByKey.has(key)) itemsByKey.set(key, []);
    itemsByKey.get(key).push(it);
  });

  const completionsByKey = new Map();
  completions.forEach((c) => {
    const ob = obligationById.get(c.obligation_id);
    if (!ob) return;
    const key = keyFn(ob);
    if (!completionsByKey.has(key)) completionsByKey.set(key, []);
    completionsByKey.get(key).push(c);
  });

  const rows = Array.from(itemsByKey.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, groupItems]) => tacticalRow(key, groupItems, completionsByKey.get(key) || []))
    .join('');

  return `<div class="report-section"><h3 class="report-heading">${escapeHtml(heading)}</h3>${rows || '<div class="empty">Nenhuma obrigação cadastrada.</div>'}</div>`;
}

function tacticalSection(items, completions) {
  return tacticalTable('Visão tática — por empresa', items, completions, (ob) => companyName(ob.company_id) || 'Sem empresa')
    + tacticalTable('Visão tática — por categoria', items, completions, (ob) => catInfo(ob.category).label)
    + `<div id="tactical-owner">${tacticalTable('Visão tática — por responsável', items, completions, (ob) => ob.responsible || 'Sem responsável')}</div>`;
}

function trendSection() {
  const now = new Date();
  const rows = Array.from({ length: 6 }, (_, i) => 5 - i).map((monthsAgo) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const monthCompletions = STATE.completions.filter((c) => c.occurrence_date >= from && c.occurrence_date <= to);
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return groupRow(label.charAt(0).toUpperCase() + label.slice(1), computeStats(monthCompletions));
  }).join('');

  return `<div class="report-section"><h3 class="report-heading">Tendência de cumprimento (últimos 6 meses)</h3>${rows}</div>`;
}

// Quantos dias olhar à frente para medir concentração de vencimentos.
const CONCENTRATION_WINDOW_DAYS = 30;
// Um dia só é destacado se tiver uma concentração bem acima da média dos
// dias que têm pelo menos um vencimento (não da média geral, que incluiria
// os dias vazios e sub-estimaria o que é "normal").
const CONCENTRATION_SPIKE_FACTOR = 1.5;

// Mostra em quais dias, dos próximos 30, os vencimentos estão concentrados
// bem acima do normal — puramente informativo (nada é reagendado
// sozinho); a ideia é o gestor enxergar picos de carga com antecedência e
// decidir se vale antecipar alguma obrigação flexível.
function concentrationSection(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const counts = new Map();
  for (let i = 0; i < CONCENTRATION_WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    counts.set(fmtKey(d), 0);
  }
  items.forEach((it) => {
    if (!it.displayDate) return;
    const key = fmtKey(it.displayDate);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });

  const daysWithVencimento = Array.from(counts.values()).filter((v) => v > 0);
  if (!daysWithVencimento.length) {
    return `<div class="report-section"><h3 class="report-heading">Concentração de vencimentos (próximos ${CONCENTRATION_WINDOW_DAYS} dias)</h3>`
      + '<div class="empty">Nenhum vencimento previsto nos próximos dias.</div></div>';
  }

  const avg = daysWithVencimento.reduce((a, b) => a + b, 0) / daysWithVencimento.length;
  const peakDays = Array.from(counts.entries())
    .filter(([, count]) => count > 0 && count > avg * CONCENTRATION_SPIKE_FACTOR)
    .sort((a, b) => b[1] - a[1]);

  if (!peakDays.length) {
    return `<div class="report-section"><h3 class="report-heading">Concentração de vencimentos (próximos ${CONCENTRATION_WINDOW_DAYS} dias)</h3>`
      + `<div class="empty">Vencimentos bem distribuídos — nenhum dia se destaca acima da média de ${avg.toFixed(1)} por dia.</div></div>`;
  }

  const rows = peakDays.map(([dateKey, count]) => {
    const d = new Date(`${dateKey}T00:00:00`);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${fmtBR(d)} <span class="status-pill tone-amber">${count} vencimento(s)</span></div>`
        + `<div class="mgmt-sub">Bem acima da média de ${avg.toFixed(1)} vencimento(s)/dia nos próximos ${CONCENTRATION_WINDOW_DAYS} dias — considere antecipar alguma obrigação flexível para aliviar esse dia.</div>`
      + '</div>'
    + '</div>';
  }).join('');

  return `<div class="report-section"><h3 class="report-heading">Concentração de vencimentos (próximos ${CONCENTRATION_WINDOW_DAYS} dias) — ${peakDays.length} dia(s) de pico</h3>${rows}</div>`;
}

function renderDashboardArea(items) {
  const completions = recentCompletions();

  return '<div class="executive-dashboard">'
    + kpiSection(items)
    + managementMapSection(items)
    + ReguaFechamento(items)
    + executionSection(items)
    + actionSection(items)
    + '<section class="dashboard-section"><div class="section-title-row"><div><span class="dashboard-eyebrow">OLHAR À FRENTE</span><h2>Riscos e predições</h2></div><p>Orientações simples, aprendidas com o histórico e a carga futura.</p></div><div class="dashboard-two-columns">'
      + predictiveRiskSection(items)
      + concentrationSection(items)
    + '</div></section>'
    + '<section class="dashboard-section"><div class="section-title-row"><div><span class="dashboard-eyebrow">FOCO OPERACIONAL</span><h2>Exceções que pedem atenção</h2></div><p>Do mais urgente para o que requer conferência.</p></div>'
      + riskSection(items)
      + ocrMismatchSection()
    + '</section>'
    + '<details class="dashboard-details"><summary><span>Explorar diagnóstico completo</span><small>Empresas, categorias, responsáveis e tendência histórica</small></summary><div class="dashboard-details-body">'
      + trendSection()
      + tacticalSection(items, completions)
    + '</div></details>'
  + '</div>';
}

export function renderDashboard() {
  if (!isManager()) {
    return '<div class="empty">Esta área é restrita a administradores.</div>';
  }

  return renderExecutiveView(activeOccurrences(), renderDashboardArea);
}
