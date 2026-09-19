import { STATE, taxRegimeName } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

function obligationsCount(companyId) {
  return STATE.obligations.filter((o) => o.company_id === companyId).length;
}

export function renderCompaniesManage() {
  let html = '<div class="mgmt-add-row">'
    + '<input type="text" id="newCompanyName" class="mgmt-add-input" placeholder="Nome da nova empresa" />'
    + '<button class="btn-primary" data-action="company-add">+ Adicionar empresa</button>'
    + '</div>';

  if (!STATE.companies.length) {
    html += '<div class="empty">Nenhuma empresa cadastrada ainda.</div>';
    return html;
  }

  const list = STATE.companies.slice().sort((a, b) => a.name.localeCompare(b.name));
  html += list.map((c) => {
    const count = obligationsCount(c.id);
    if (STATE.editingCompanyId === c.id) {
      return `<div class="mgmt-row" data-company-row="${c.id}">`
        + '<div class="mgmt-main">'
          + `<input type="text" class="mgmt-add-input" id="editCompanyName-${c.id}" value="${escapeHtml(c.name)}" />`
        + '</div>'
        + '<div class="mgmt-actions">'
          + `<button class="icon-btn" data-action="company-save-edit" data-id="${c.id}">Salvar</button>`
          + `<button class="icon-btn" data-action="company-cancel-edit" data-id="${c.id}">Cancelar</button>`
        + '</div>'
      + '</div>';
    }
    const regimeLine = c.tax_regime_id
      ? `Regime: <strong>${escapeHtml(taxRegimeName(c.tax_regime_id))}</strong>`
      : 'Regime: <span style="color:var(--ink-soft);">não definido — defina em Gerenciar → Regimes tributários</span>';
    return `<div class="mgmt-row" data-company-row="${c.id}">`
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(c.name)}</div>`
        + `<div class="mgmt-sub">${count} obrigação(ões) vinculada(s)</div>`
        + `<div class="mgmt-sub">${regimeLine}</div>`
      + '</div>'
      + '<div class="mgmt-actions">'
        + `<button class="icon-btn" data-action="company-edit" data-id="${c.id}">Editar</button>`
        + (c.tax_regime_id ? `<button class="icon-btn" data-action="company-apply-regime" data-id="${c.id}">📋 Trazer obrigações do regime</button>` : '')
        + `<button class="icon-btn danger" data-action="company-delete" data-id="${c.id}">Excluir</button>`
      + '</div>'
    + '</div>';
  }).join('');

  return html;
}
