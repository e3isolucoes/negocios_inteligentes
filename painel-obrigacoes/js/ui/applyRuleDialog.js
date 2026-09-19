import { STATE } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

// Diálogo para aplicar um modelo de mercado a várias empresas de uma vez —
// cria uma obrigação por empresa selecionada, copiando os campos da regra.
// Retorna Promise<string[] | null>: ids das empresas escolhidas, ou null se
// cancelar.
export function applyRuleDialog({ ruleName }) {
  return new Promise((resolve) => {
    const companies = STATE.companies.slice().sort((a, b) => a.name.localeCompare(b.name));

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const rowsHtml = companies.length
      ? companies.map((c) => (
        `<label class="apply-rule-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;">`
          + `<input type="checkbox" class="apply-rule-check" value="${c.id}" />`
          + `<span>${escapeHtml(c.name)}</span>`
        + '</label>'
      )).join('')
      : '<div class="empty">Nenhuma empresa cadastrada ainda.</div>';

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="applyRuleTitle">
        <h2 id="applyRuleTitle">Aplicar modelo "${escapeHtml(ruleName)}" a empresas</h2>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 10px;">
          Cria uma obrigação nova em cada empresa marcada, copiando os dados do modelo.
          Empresas que já têm uma obrigação com este nome não são duplicadas.
        </p>
        <div style="margin-bottom:8px;">
          <button type="button" class="icon-btn" data-act="select-all">Marcar todas</button>
          <button type="button" class="icon-btn" data-act="select-none">Desmarcar todas</button>
        </div>
        <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px;">
          ${rowsHtml}
        </div>
        <div class="modal-actions">
          <div class="right">
            <button type="button" class="btn-ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="btn-primary" data-act="confirm">Aplicar</button>
          </div>
        </div>
      </div>`;

    function close(result) {
      backdrop.remove();
      resolve(result);
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    backdrop.querySelector('[data-act="select-all"]').addEventListener('click', () => {
      backdrop.querySelectorAll('.apply-rule-check').forEach((cb) => { cb.checked = true; });
    });
    backdrop.querySelector('[data-act="select-none"]').addEventListener('click', () => {
      backdrop.querySelectorAll('.apply-rule-check').forEach((cb) => { cb.checked = false; });
    });
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      const ids = Array.from(backdrop.querySelectorAll('.apply-rule-check:checked')).map((cb) => cb.value);
      if (!ids.length) return;
      close(ids);
    });

    document.body.appendChild(backdrop);
  });
}
