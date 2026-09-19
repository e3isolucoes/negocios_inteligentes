import { STATE } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

// Diálogo para escolher quais obrigações do catálogo (obligation_rules)
// pertencem a um regime tributário. Retorna Promise<string[] | null>: ids
// das regras marcadas, ou null se cancelar.
export function regimeRulesDialog({ regime }) {
  return new Promise((resolve) => {
    const rules = STATE.obligationRules.slice().sort((a, b) => a.name.localeCompare(b.name));
    const linkedIds = new Set(
      STATE.taxRegimeRules.filter((l) => l.tax_regime_id === regime.id).map((l) => l.obligation_rule_id),
    );

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const rowsHtml = rules.length
      ? rules.map((r) => (
        '<label class="apply-rule-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;">'
          + `<input type="checkbox" class="regime-rule-check" value="${r.id}" ${linkedIds.has(r.id) ? 'checked' : ''} />`
          + `<span>${escapeHtml(r.name)}</span>`
        + '</label>'
      )).join('')
      : '<div class="empty">Nenhuma regra no catálogo ainda (cadastre em Gerenciar → Regras).</div>';

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="regimeRulesTitle">
        <h2 id="regimeRulesTitle">Obrigações do regime "${escapeHtml(regime.name)}"</h2>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 10px;">
          Marque quais obrigações do catálogo (Gerenciar → Regras) fazem parte deste regime tributário.
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
      backdrop.querySelectorAll('.regime-rule-check').forEach((cb) => { cb.checked = true; });
    });
    backdrop.querySelector('[data-act="select-none"]')?.addEventListener('click', () => {
      backdrop.querySelectorAll('.regime-rule-check').forEach((cb) => { cb.checked = false; });
    });
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      const ids = Array.from(backdrop.querySelectorAll('.regime-rule-check:checked')).map((cb) => cb.value);
      close(ids);
    });

    document.body.appendChild(backdrop);
  });
}
