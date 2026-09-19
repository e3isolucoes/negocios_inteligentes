import { STATE } from '../state.js';
import { escapeHtml, fmtBR } from '../dateUtils.js';

export function renderHolidaysManage() {
  const currentYear = new Date().getFullYear();

  let html = '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Feriados cadastrados aqui são usados quando uma obrigação tem a opção '
    + '"empurrar para o próximo dia útil" marcada — o painel evita mostrar o '
    + 'vencimento caindo num feriado ou fim de semana.'
    + '</div>';

  html += '<div class="mgmt-add-row">'
    + `<button class="btn-ghost" type="button" data-action="holidays-import-national" data-year="${currentYear}">⬇ Importar feriados nacionais de ${currentYear}</button>`
    + `<button class="btn-ghost" type="button" data-action="holidays-import-national" data-year="${currentYear + 1}">⬇ Importar feriados nacionais de ${currentYear + 1}</button>`
    + '</div>';

  html += '<div class="mgmt-add-row">'
    + '<input type="date" id="newHolidayDate" class="mgmt-add-input" style="flex:none;width:170px;" />'
    + '<input type="text" id="newHolidayName" class="mgmt-add-input" placeholder="Nome do feriado" />'
    + '<button class="btn-primary" type="button" data-action="holiday-add">+ Adicionar</button>'
    + '</div>';

  if (!STATE.holidays.length) {
    html += '<div class="empty">Nenhum feriado cadastrado ainda.</div>';
    return html;
  }

  const list = STATE.holidays.slice().sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
  html += list.map((h) => (
    '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(h.name)}</div>`
        + `<div class="mgmt-sub">${fmtBR(new Date(`${h.holiday_date}T00:00:00`))} · ${h.scope}</div>`
      + '</div>'
      + '<div class="mgmt-actions">'
        + `<button class="icon-btn danger" data-action="holiday-delete" data-id="${h.id}">Excluir</button>`
      + '</div>'
    + '</div>'
  )).join('');

  return html;
}
