import { escapeHtml } from '../dateUtils.js';

// Diálogo simples de criar/editar um regime tributário (nome + descrição).
// Retorna Promise<{ name: string, description: string } | null>.
export function regimeDialog({ existing } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="regimeDialogTitle">
        <h2 id="regimeDialogTitle">${existing ? 'Editar regime tributário' : 'Novo regime tributário'}</h2>
        <div class="field"><label>Nome</label><input id="regimeNameInput" type="text" value="${escapeHtml(existing?.name || '')}" placeholder="Ex.: Lucro Presumido" /></div>
        <div class="field"><label>Descrição (opcional)</label><textarea id="regimeDescInput" placeholder="Breve explicação do regime, para a equipe">${escapeHtml(existing?.description || '')}</textarea></div>
        <p class="field-error hidden" id="regimeDialogError">Informe o nome do regime.</p>
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
    backdrop.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      const name = backdrop.querySelector('#regimeNameInput').value.trim();
      const description = backdrop.querySelector('#regimeDescInput').value.trim();
      if (!name) {
        backdrop.querySelector('#regimeDialogError').classList.remove('hidden');
        return;
      }
      close({ name, description });
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('#regimeNameInput').focus();
  });
}
