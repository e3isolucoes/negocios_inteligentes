import { escapeHtml, fmtBR, fmtKey } from '../dateUtils.js';

// Diálogo de ajuste pontual de data (prorrogação de UMA ocorrência).
// Retorna Promise<{ overrideDate: string, reason: string } | 'remove' | null>
// — null se cancelar, 'remove' se pediu para remover um ajuste existente.
export function overrideDialog({ obligationName, rawDate, existingOverride }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const defaultDateValue = existingOverride ? existingOverride.override_date : fmtKey(rawDate);

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="overrideTitle">
        <h2 id="overrideTitle">Ajustar data — "${escapeHtml(obligationName)}"</h2>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 14px;">
          Vencimento padrão calculado pela regra: <strong>${fmtBR(rawDate)}</strong>.
          Isso ajusta só esta ocorrência — a regra de recorrência continua igual para as próximas.
        </p>
        <div class="field"><label>Nova data</label><input type="date" id="overrideDateInput" value="${defaultDateValue}" /></div>
        <div class="field"><label>Motivo (opcional)</label><input type="text" id="overrideReasonInput" placeholder="Ex.: prorrogação divulgada pela Receita" value="${escapeHtml(existingOverride?.reason || '')}" /></div>
        <div class="modal-actions">
          <div>${existingOverride ? '<button type="button" class="btn-danger-text" data-act="remove">Remover ajuste</button>' : ''}</div>
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
    backdrop.querySelector('[data-act="remove"]')?.addEventListener('click', () => close('remove'));
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      const overrideDate = backdrop.querySelector('#overrideDateInput').value;
      const reason = backdrop.querySelector('#overrideReasonInput').value.trim();
      if (!overrideDate) return;
      close({ overrideDate, reason });
    });

    document.body.appendChild(backdrop);
  });
}
