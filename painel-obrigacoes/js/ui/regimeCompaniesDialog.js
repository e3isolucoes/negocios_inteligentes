import { STATE } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

// Diálogo para escolher quais empresas pertencem a um regime tributário.
// Cada empresa só tem UM regime por vez — marcar uma empresa aqui move ela
// para este regime, mesmo que já estivesse vinculada a outro (o aviso
// abaixo deixa isso explícito). Retorna Promise<string[] | null>: ids das
// empresas marcadas, ou null se cancelar.
export function regimeCompaniesDialog({ regime }) {
  return new Promise((resolve) => {
    const companies = STATE.companies.slice().sort((a, b) => a.name.localeCompare(b.name));

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const rowsHtml = companies.length
      ? companies.map((c) => {
        const other = c.tax_regime_id && c.tax_regime_id !== regime.id
          ? STATE.taxRegimes.find((r) => r.id === c.tax_regime_id)?.name
          : null;
        return '<label class="apply-rule-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;">'
          + `<input type="checkbox" class="regime-company-check" value="${c.id}" ${c.tax_regime_id === regime.id ? 'checked' : ''} />`
          + `<span>${escapeHtml(c.name)}${other ? ` <span style="color:var(--ink-soft);font-size:12px;">— hoje em "${escapeHtml(other)}"</span>` : ''}</span>`
        + '</label>';
      }).join('')
      : '<div class="empty">Nenhuma empresa cadastrada ainda (aba Gerenciar → Empresas).</div>';

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="regimeCompaniesTitle">
        <h2 id="regimeCompaniesTitle">Empresas no regime "${escapeHtml(regime.name)}"</h2>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 10px;">
          Cada empresa tem só um regime por vez — marcar uma empresa que já está em outro regime move ela para este.
        </p>
        <div style="margin-bottom:8px;">
          <button type="button" class="icon-btn" data-act="select-all">Marcar todas</button>
          <button type="button" class="icon-btn" data-act="select-none">Desmarcar todas</button>
        </div>
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px;">
          ${rowsHtml}
        </div>
        <div class="modal-actions">
          <div class="right">
            <button type="button" class="btn-ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="btn-primary" data-act="confirm">Salvar</button>
          </div>
        </div>
      </div>`;

    function close(result) {
      backdrop.remove();
      resolve(result);
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    backdrop.querySelector('[data-act="select-all"]')?.addEventListener('click', () => {
      backdrop.querySelectorAll('.regime-company-check').forEach((cb) => { cb.checked = true; });
    });
    backdrop.querySelector('[data-act="select-none"]')?.addEventListener('click', () => {
      backdrop.querySelectorAll('.regime-company-check').forEach((cb) => { cb.checked = false; });
    });
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      const ids = Array.from(backdrop.querySelectorAll('.regime-company-check:checked')).map((cb) => cb.value);
      close(ids);
    });

    document.body.appendChild(backdrop);
  });
}
