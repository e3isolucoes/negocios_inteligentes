import { STATE } from '../state.js';
import { escapeHtml } from '../dateUtils.js';
import { findSimilarCompanyWarning } from '../csv.js';

function renderInstructions() {
  return '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Cadastre várias obrigações de uma vez enviando uma planilha CSV ou Excel. '
    + 'Baixe o modelo abaixo, preencha no Excel/Google Sheets/LibreOffice '
    + '(mantendo os nomes das colunas) e envie o arquivo de volta aqui. '
    + 'Empresas que ainda não existirem são criadas automaticamente; se o '
    + 'nome do responsável bater (mesmo com acentuação ou erro de digitação '
    + 'pequeno diferente) com alguém já cadastrado no sistema, o vínculo é '
    + 'feito sozinho — senão, fica como texto livre. Empresa com nome '
    + 'parecido com uma já cadastrada só gera um aviso (nunca mescla '
    + 'sozinho, para não arriscar juntar duas empresas diferentes).'
    + '</div>'
    + '<div class="mgmt-add-row">'
      + '<button class="btn-ghost" type="button" data-action="csv-download-template">⬇ Baixar modelo CSV</button>'
      + '<input type="file" id="csvFileInput" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />'
    + '</div>';
}

function renderPreview() {
  const { fileName, rows } = STATE.importPreview;
  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  let html = `<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">`
    + `Arquivo <strong>${escapeHtml(fileName)}</strong>: `
    + `<strong style="color:var(--green);">${validRows.length} linha(s) prontas para importar</strong>`
    + (invalidRows.length ? `, <strong style="color:var(--red);">${invalidRows.length} com erro (serão ignoradas)</strong>.` : '.')
    + '</div>';

  html += rows.map((r) => {
    const raw = r.raw || {};
    const summary = `${escapeHtml(raw.nome || '(sem nome)')} · ${escapeHtml(raw.categoria || '—')} · ${escapeHtml(raw.frequencia || '—')}`;
    if (r.valid) {
      const similarCompany = raw.empresa ? findSimilarCompanyWarning(raw.empresa, STATE.companies) : null;
      return '<div class="mgmt-row">'
        + '<div class="mgmt-main">'
          + `<div class="mgmt-name">Linha ${r.rowNumber}: ${summary}</div>`
          + '<div class="mgmt-sub" style="color:var(--green);">✓ Pronta para importar</div>'
          + (similarCompany ? `<div class="mgmt-sub" style="color:var(--amber);">⚠ Empresa parecida já cadastrada: "${escapeHtml(similarCompany)}" — confira se não é duplicata antes de confirmar.</div>` : '')
        + '</div>'
      + '</div>';
    }
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">Linha ${r.rowNumber}: ${summary}</div>`
        + `<div class="mgmt-sub" style="color:var(--red);">${r.errors.map((e) => escapeHtml(e)).join(' · ')}</div>`
      + '</div>'
    + '</div>';
  }).join('');

  html += '<div class="modal-actions" style="margin-top:16px;">'
    + '<div class="right">'
      + '<button class="btn-ghost" type="button" data-action="csv-cancel-import">Cancelar</button>'
      + `<button class="btn-primary" type="button" data-action="csv-confirm-import" ${validRows.length ? '' : 'disabled'}>Confirmar importação (${validRows.length})</button>`
    + '</div>'
  + '</div>';

  return html;
}

export function renderImportManage() {
  if (STATE.importPreview) return renderPreview();
  return renderInstructions();
}
