import { STATE, rulesForRegime } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

function companiesCount(regimeId) {
  return STATE.companies.filter((c) => c.tax_regime_id === regimeId).length;
}

export function renderRegimesManage() {
  let html = '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Catálogo de regimes tributários (Simples Nacional, Lucro Presumido, Lucro Real, MEI etc.), mantido pela gerência. '
    + 'Vincule quais obrigações do catálogo (Gerenciar → Regras) valem para cada regime e quais empresas estão '
    + 'enquadradas nele — depois, em Gerenciar → Empresas, dá para trazer todas as obrigações do regime da empresa '
    + 'de uma vez, já com o checklist de cada uma. <strong>Não é aconselhamento tributário:</strong> o vínculo '
    + 'regime → obrigação é um ponto de partida curado manualmente (não existe hoje uma base de dados oficial do '
    + 'Governo pronta para consumir isso) — confira sempre o enquadramento fiscal real de cada empresa.'
    + '</div>';

  html += '<div class="mgmt-add-row"><button class="btn-primary" type="button" data-action="regime-new">+ Novo regime</button></div>';

  if (!STATE.taxRegimes.length) {
    html += '<div class="empty">Nenhum regime cadastrado ainda.</div>';
    return html;
  }

  const list = STATE.taxRegimes.slice().sort((a, b) => a.name.localeCompare(b.name));
  html += list.map((r) => {
    const rules = rulesForRegime(r.id);
    const rulesLabel = rules.length
      ? rules.map((rule) => escapeHtml(rule.name)).join(', ')
      : 'Nenhuma obrigação vinculada ainda';
    const companies = companiesCount(r.id);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(r.name)}</div>`
        + (r.description ? `<div class="mgmt-sub">${escapeHtml(r.description)}</div>` : '')
        + `<div class="mgmt-sub">📋 ${rulesLabel}</div>`
        + `<div class="mgmt-sub">🏢 ${companies} empresa(s) vinculada(s)</div>`
      + '</div>'
      + '<div class="mgmt-actions">'
        + `<button class="icon-btn" data-action="regime-edit" data-id="${r.id}">Editar</button>`
        + `<button class="icon-btn" data-action="regime-link-rules" data-id="${r.id}">🔗 Vincular obrigações</button>`
        + `<button class="icon-btn" data-action="regime-link-companies" data-id="${r.id}">🏢 Vincular empresas</button>`
        + `<button class="icon-btn danger" data-action="regime-delete" data-id="${r.id}">Excluir</button>`
      + '</div>'
    + '</div>';
  }).join('');

  return html;
}
