import { escapeHtml } from '../dateUtils.js';
import { analyzeAttachment } from '../ocr.js';

// Retorna Promise<{
//   file: File|null, checklistTotal: number, checklistChecked: number,
//   ocrStatus: 'ok'|'mismatch'|'not_checked', ocrExtractedPeriod: string|null,
// } | null> — null se a pessoa cancelar. `checklistItems` pode ser uma
// lista vazia (obrigação sem checklist cadastrado). `requiresAttachment`
// mantém o comprovante obrigatório por padrão e permite exceções explícitas.
// `occurrenceDate` ("YYYY-MM-DD") é usado só para a conferência automática
// de competência do comprovante (ver js/ocr.js) — é heurística e nunca
// bloqueia sozinha, só exige uma confirmação extra quando há divergência.
// Cada item já chega pré-marcado com `it.completed` (estado persistido —
// ver state.js/checklistProgress), caso a pessoa já tenha ido riscando o
// checklist direto no cartão do Painel antes de abrir este diálogo.
// `onToggleItem(itemId, checked)` (opcional) é chamado a cada marcar/
// desmarcar AQUI DENTRO, para persistir na hora — mantém as duas telas
// (cartão e este diálogo) sempre em sincronia.
export function completeDialog(obligationName, checklistItems, occurrenceDate, {
  onToggleItem, requiresAttachment = true, allowsNoMovementWithoutAttachment = false,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const checklistHtml = checklistItems.length
      ? '<div class="field"><label>Checklist — marque tudo antes de concluir</label>'
        + '<div class="checklist-complete-list">'
        + checklistItems.map((it, i) => (
          `<label class="checklist-complete-item"><input type="checkbox" class="completeChecklistItem" data-idx="${i}" data-item-id="${it.id}" ${it.completed ? 'checked' : ''} /> ${escapeHtml(it.description)}</label>`
        )).join('')
        + '</div></div>'
      : '';

    backdrop.innerHTML = `
      <div class="modal confirm-card" role="dialog" aria-modal="true" aria-labelledby="completeTitle">
        <h2 id="completeTitle">Concluir "${escapeHtml(obligationName)}"</h2>
        ${checklistHtml}
        <div class="field">
          ${allowsNoMovementWithoutAttachment ? `<label>Situação da atividade</label>
          <select id="completeMovementStatus"><option value="com_movimento">Com movimento</option><option value="sem_movimento">Sem movimento</option></select>` : ''}
          <label id="completeAttachmentLabel">Comprovante (${requiresAttachment ? 'obrigatório' : 'opcional'})</label>
          <input type="file" id="completeFileInput" />
          <p class="field-error hidden" id="completeFieldError">Anexe o comprovante para concluir.</p>
          <p id="ocrStatusMsg" class="hidden" style="font-size:12.5px;margin-top:7px;color:var(--ink-soft);"></p>
          <label id="ocrConfirmRow" class="hidden" style="display:flex;align-items:flex-start;gap:8px;font-weight:400;margin-top:7px;font-size:13px;">
            <input type="checkbox" id="ocrConfirmCheckbox" style="width:auto;margin-top:2px;" /> Confirmo que revisei e o comprovante está correto mesmo assim
          </label>
        </div>
        <div class="modal-actions">
          <div class="right">
            <button type="button" class="btn-ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="btn-primary" data-act="confirm" id="completeConfirmBtn" disabled>Concluir</button>
          </div>
        </div>
      </div>`;

    function close(result) {
      backdrop.remove();
      resolve(result);
    }

    const confirmBtn = backdrop.querySelector('#completeConfirmBtn');
    const fileInput = backdrop.querySelector('#completeFileInput');
    const checkboxes = Array.from(backdrop.querySelectorAll('.completeChecklistItem'));
    const ocrStatusEl = backdrop.querySelector('#ocrStatusMsg');
    const ocrConfirmRow = backdrop.querySelector('#ocrConfirmRow');
    const ocrConfirmCheckbox = backdrop.querySelector('#ocrConfirmCheckbox');
    const movementStatus = backdrop.querySelector('#completeMovementStatus');
    const attachmentLabel = backdrop.querySelector('#completeAttachmentLabel');

    let ocrResult = null;
    let analyzing = false;
    let analysisToken = 0;

    function updateEnabled() {
      const allChecked = checkboxes.every((c) => c.checked);
      const hasFile = fileInput.files && fileInput.files.length > 0;
      const needsOcrConfirm = ocrResult?.status === 'mismatch';
      const ocrOk = !needsOcrConfirm || ocrConfirmCheckbox.checked;
      const effectiveRequirement = requiresAttachment && movementStatus?.value !== 'sem_movimento';
      attachmentLabel.textContent = `Comprovante (${effectiveRequirement ? 'obrigatório' : 'opcional'})`;
      confirmBtn.disabled = !(allChecked && (hasFile || !effectiveRequirement) && !analyzing && ocrOk);
    }
    checkboxes.forEach((c) => c.addEventListener('change', () => {
      updateEnabled();
      onToggleItem?.(c.getAttribute('data-item-id'), c.checked);
    }));
    ocrConfirmCheckbox.addEventListener('change', updateEnabled);
    movementStatus?.addEventListener('change', updateEnabled);

    // Avalia também o estado inicial: quando não há checklist nem comprovante
    // obrigatório, nenhum evento de mudança ocorre para habilitar o botão.
    updateEnabled();

    fileInput.addEventListener('change', async () => {
      const myToken = ++analysisToken;
      ocrResult = null;
      ocrConfirmRow.classList.add('hidden');

      const file = fileInput.files?.[0];
      if (!file) {
        analyzing = false;
        ocrStatusEl.classList.add('hidden');
        updateEnabled();
        return;
      }

      analyzing = true;
      ocrStatusEl.classList.remove('hidden');
      ocrStatusEl.textContent = 'Analisando comprovante…';
      updateEnabled();

      const result = await analyzeAttachment(file, occurrenceDate);
      if (myToken !== analysisToken) return; // arquivo trocado enquanto analisava

      analyzing = false;
      ocrResult = result;
      const toneMap = { ok: 'green', mismatch: 'amber', not_checked: 'muted' };
      const labelMap = { ok: 'Conferido', mismatch: 'Divergência', not_checked: 'Não verificado' };
      ocrStatusEl.innerHTML = `<span class="status-pill tone-${toneMap[result.status]}">${labelMap[result.status]}</span> ${escapeHtml(result.message)}`;
      if (result.status === 'mismatch') {
        ocrConfirmRow.classList.remove('hidden');
        ocrConfirmCheckbox.checked = false;
      }
      updateEnabled();
    });

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    confirmBtn.addEventListener('click', () => {
      const file = fileInput.files?.[0] || null;
      const allChecked = checkboxes.every((c) => c.checked);
      const effectiveRequirement = requiresAttachment && movementStatus?.value !== 'sem_movimento';
      if ((effectiveRequirement && !file) || !allChecked) {
        backdrop.querySelector('#completeFieldError').classList.remove('hidden');
        return;
      }
      close({
        file,
        checklistTotal: checkboxes.length,
        checklistChecked: checkboxes.filter((c) => c.checked).length,
        ocrStatus: ocrResult?.status || 'not_checked',
        ocrExtractedPeriod: ocrResult?.extractedPeriod || null,
        movementStatus: movementStatus?.value || 'nao_informado',
      });
    });

    document.body.appendChild(backdrop);
  });
}
