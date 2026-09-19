import { STATE } from '../state.js';
import { catInfo, FREQ_LABELS } from '../constants.js';
import { escapeHtml, freqSummary, businessDayShiftShortLabel } from '../dateUtils.js';

export function renderRulesManage() {
  let html = '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Catálogo de obrigações-padrão praticadas no mercado (DCTFWeb, ECD, ICMS-ST etc.), mantido pela gerência. '
    + 'Serve como modelo para preencher rapidamente uma obrigação nova (Nova obrigação → "Usar modelo de mercado") — '
    + 'editar ou excluir uma regra aqui <strong>não</strong> afeta obrigações já cadastradas a partir dela.'
    + '</div>';

  html += '<div class="mgmt-add-row"><button class="btn-primary" type="button" data-action="rule-new">+ Nova regra</button></div>';

  if (!STATE.obligationRules.length) {
    html += '<div class="empty">Nenhuma regra cadastrada ainda.</div>';
    return html;
  }

  const list = STATE.obligationRules.slice().sort((a, b) => a.name.localeCompare(b.name));
  html += list.map((r) => {
    const cat = catInfo(r.category);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(r.name)} <span class="badge" style="border-color:${cat.color};color:${cat.color};">${cat.label}</span></div>`
        + `<div class="mgmt-sub">${FREQ_LABELS[r.frequency]} · ${escapeHtml(freqSummary(r))}${businessDayShiftShortLabel(r.business_day_shift) ? ` · ${businessDayShiftShortLabel(r.business_day_shift)}` : ''}</div>`
        + (r.notes ? `<div class="mgmt-sub">${escapeHtml(r.notes)}</div>` : '')
      + '</div>'
      + '<div class="mgmt-actions">'
        + `<button class="icon-btn" data-action="rule-edit" data-id="${r.id}">Editar</button>`
        + `<button class="icon-btn" data-action="rule-apply" data-id="${r.id}">🏢 Aplicar a empresas</button>`
        + `<button class="icon-btn danger" data-action="rule-delete" data-id="${r.id}">Excluir</button>`
      + '</div>'
    + '</div>';
  }).join('');

  return html;
}
