import { escapeHtml } from '../dateUtils.js';

// Retorna uma Promise<boolean>: true se a pessoa confirmar, false se cancelar.
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle">
        <h2 id="confirmTitle">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <div class="right">
            <button type="button" class="btn-ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;

    function close(result) {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-act="ok"]').focus();
  });
}
