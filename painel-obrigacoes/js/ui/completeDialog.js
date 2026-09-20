import { escapeHtml } from '../dateUtils.js';
import { analyzeAttachment } from '../ocr.js';

function requirementRow(key, label) {
  return '<div class="completion-requirement is-pending" data-requirement="' + key + '">'
    + '<span class="completion-requirement-icon" aria-hidden="true">!</span>'
    + '<span class="completion-requirement-copy"><strong>' + escapeHtml(label) + '</strong><small></small></span>'
    + '</div>';
}

// Fluxo de conclusão guiado por prontidão. O botão só é liberado quando
// todos os requisitos obrigatórios estão satisfeitos, e a pessoa sempre vê
// exatamente o que falta fazer antes de tentar salvar.
export function completeDialog(obligationName, checklistItems, occurrenceDate, {
  onToggleItem,
  requiresAttachment = true,
  allowsNoMovementWithoutAttachment = false,
  validationRequired = false,
  validatorReady = true,
  validatorLabel = '',
  checklistUnavailable = false,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const checklistHtml = checklistItems.length
      ? '<div class="field"><label>Checklist da atividade</label>'
        + '<div class="checklist-complete-list">'
        + checklistItems.map((it, i) => (
          `<label class="checklist-complete-item"><input type="checkbox" class="completeChecklistItem" data-idx="${i}" data-item-id="${it.id}" ${it.completed ? 'checked' : ''} /> ${escapeHtml(it.description)}</label>`
        )).join('')
        + '</div></div>'
      : '';

    backdrop.innerHTML = `
      <div class="modal complete-dialog" role="dialog" aria-modal="true" aria-labelledby="completeTitle">
        <div class="complete-dialog-heading">
          <span class="complete-dialog-kicker">PRONTIDÃO DA ENTREGA</span>
          <h2 id="completeTitle">Concluir "${escapeHtml(obligationName)}"</h2>
          <p>Confira os requisitos abaixo. O botão de conclusão será liberado assim que tudo que for obrigatório estiver pronto.</p>
        </div>

        <section class="completion-readiness" aria-label="Requisitos para concluir">
          <div class="completion-readiness-head">
            <strong>O que falta para concluir</strong>
            <span class="completion-readiness-summary" id="completionReadinessSummary">Verificando…</span>
          </div>
          <div class="completion-requirements">
            ${requirementRow('checklist', 'Checklist')}
            ${requirementRow('attachment', 'Comprovante')}
            ${requirementRow('validation', 'Validação')}
            ${requirementRow('analysis', 'Conferência do comprovante')}
          </div>
          <div class="completion-blockers" id="completionBlockers" role="status" aria-live="polite"></div>
        </section>

        ${checklistHtml}

        <div class="field">
          ${allowsNoMovementWithoutAttachment ? `<label>Situação da atividade</label>
          <select id="completeMovementStatus"><option value="com_movimento">Com movimento</option><option value="sem_movimento">Sem movimento</option></select>` : ''}
          <label id="completeAttachmentLabel">Comprovante (${requiresAttachment ? 'obrigatório' : 'opcional'})</label>
          <input type="file" id="completeFileInput" />
          <p class="field-error hidden" id="completeFieldError"></p>
          <p id="ocrStatusMsg" class="completion-ocr-status hidden"></p>
          <label id="ocrConfirmRow" class="completion-ocr-confirm hidden">
            <input type="checkbox" id="ocrConfirmCheckbox" /> Confirmo que revisei e o comprovante está correto mesmo com a divergência indicada
          </label>
        </div>

        <div class="modal-actions">
          <div class="right">
            <button type="button" class="btn-ghost" data-act="cancel">Cancelar</button>
            <button type="button" class="btn-primary" data-act="confirm" id="completeConfirmBtn" disabled>Concluir atividade</button>
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
    const blockersEl = backdrop.querySelector('#completionBlockers');
    const summaryEl = backdrop.querySelector('#completionReadinessSummary');
    const fieldError = backdrop.querySelector('#completeFieldError');

    let ocrResult = null;
    let analyzing = false;
    let analysisToken = 0;
    let pendingChecklistSaves = 0;
    let checklistSaveError = '';
    let currentBlockers = [];

    function setRequirement(key, ready, detail, waiting = false) {
      const row = backdrop.querySelector(`[data-requirement="${key}"]`);
      if (!row) return;
      row.classList.toggle('is-ready', ready);
      row.classList.toggle('is-pending', !ready && !waiting);
      row.classList.toggle('is-waiting', waiting);
      row.querySelector('.completion-requirement-icon').textContent = ready ? '✓' : (waiting ? '…' : '!');
      row.querySelector('small').textContent = detail;
    }

    function updateEnabled() {
      const checked = checkboxes.filter((item) => item.checked).length;
      const allChecked = !checklistUnavailable && checkboxes.every((item) => item.checked);
      const hasFile = Boolean(fileInput.files && fileInput.files.length > 0);
      const effectiveRequirement = requiresAttachment && movementStatus?.value !== 'sem_movimento';
      const attachmentReady = hasFile || !effectiveRequirement;
      const validationReady = !validationRequired || validatorReady;
      const needsOcrConfirm = ocrResult?.status === 'mismatch';
      const analysisReady = !analyzing && (!hasFile || !needsOcrConfirm || ocrConfirmCheckbox.checked);

      const blockers = [];
      if (checklistUnavailable) blockers.push('Recarregue o checklist: não foi possível confirmar os itens obrigatórios.');
      else if (checklistSaveError) blockers.push(checklistSaveError);
      else if (pendingChecklistSaves > 0) blockers.push('Aguarde: estamos salvando o checklist.');
      else if (!allChecked) blockers.push(`Conclua o checklist (${checked}/${checkboxes.length} itens marcados).`);
      if (!attachmentReady) blockers.push('Anexe o comprovante obrigatório.');
      if (!validationReady) {
        blockers.push(obligationName && validationRequired
          ? (validatorLabel
            ? `A validação precisa ser feita por outra pessoa. Validador atual: ${validatorLabel}.`
            : 'A Gestão precisa definir um validador para esta atividade.')
          : 'A validação da atividade ainda não está configurada.');
      }
      if (analyzing) blockers.push('Aguarde a conferência automática do comprovante.');
      else if (needsOcrConfirm && !ocrConfirmCheckbox.checked) blockers.push('Confirme que revisou a divergência encontrada no comprovante.');

      setRequirement(
        'checklist',
        allChecked,
        checklistUnavailable
          ? 'Não foi possível carregar o checklist.'
          : (checklistSaveError
            ? 'Falha ao salvar um item do checklist.'
            : (pendingChecklistSaves > 0
              ? 'Salvando alterações do checklist…'
              : (checkboxes.length ? `${checked}/${checkboxes.length} itens concluídos` : 'Nenhum checklist exigido.'))),
      );
      setRequirement(
        'attachment',
        attachmentReady,
        effectiveRequirement
          ? (hasFile ? 'Comprovante anexado.' : 'Obrigatório para esta conclusão.')
          : (hasFile ? 'Comprovante anexado.' : 'Opcional nesta situação.'),
      );
      setRequirement(
        'validation',
        validationReady,
        validationRequired
          ? (validatorReady
            ? `Validador definido${validatorLabel ? `: ${validatorLabel}` : '.'}`
            : (validatorLabel ? 'O executor não pode ser o próprio validador.' : 'Validador ainda não definido.'))
          : 'Não exige validação adicional.',
      );
      setRequirement(
        'analysis',
        analysisReady,
        analyzing
          ? 'Analisando o arquivo…'
          : (!hasFile
            ? 'Será feita quando houver comprovante.'
            : (needsOcrConfirm && !ocrConfirmCheckbox.checked
              ? 'Divergência encontrada: revise e confirme.'
              : (ocrResult?.status === 'ok' ? 'Comprovante conferido.' : 'Conferência concluída.'))),
        analyzing,
      );

      currentBlockers = blockers;
      const ready = blockers.length === 0;
      confirmBtn.disabled = !ready;
      confirmBtn.textContent = ready ? 'Concluir atividade' : `Faltam ${blockers.length} requisito${blockers.length === 1 ? '' : 's'}`;
      summaryEl.textContent = ready ? 'Pronto para concluir' : `${blockers.length} pendência${blockers.length === 1 ? '' : 's'}`;
      summaryEl.classList.toggle('is-ready', ready);
      blockersEl.classList.toggle('is-ready', ready);
      blockersEl.innerHTML = ready
        ? '<strong>✓ Tudo pronto.</strong> Você já pode concluir esta atividade.'
        : '<strong>Antes de concluir:</strong><ul>' + blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join('') + '</ul>';
      attachmentLabel.textContent = `Comprovante (${effectiveRequirement ? 'obrigatório' : 'opcional'})`;
      fieldError.classList.add('hidden');
    }

    checkboxes.forEach((checkbox) => checkbox.addEventListener('change', async () => {
      const previous = !checkbox.checked;
      checklistSaveError = '';
      pendingChecklistSaves += 1;
      updateEnabled();
      try {
        await onToggleItem?.(checkbox.getAttribute('data-item-id'), checkbox.checked);
      } catch (error) {
        console.error('Falha ao persistir checklist durante a conclusão', error);
        checkbox.checked = previous;
        checklistSaveError = 'Não foi possível salvar o checklist. Tente marcar o item novamente.';
      } finally {
        pendingChecklistSaves = Math.max(0, pendingChecklistSaves - 1);
        updateEnabled();
      }
    }));
    ocrConfirmCheckbox.addEventListener('change', updateEnabled);
    movementStatus?.addEventListener('change', updateEnabled);

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
      if (myToken !== analysisToken) return;

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

    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(null); });
    backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    confirmBtn.addEventListener('click', () => {
      updateEnabled();
      if (currentBlockers.length) {
        fieldError.textContent = currentBlockers[0];
        fieldError.classList.remove('hidden');
        return;
      }

      const file = fileInput.files?.[0] || null;
      close({
        file,
        checklistTotal: checkboxes.length,
        checklistChecked: checkboxes.filter((item) => item.checked).length,
        ocrStatus: ocrResult?.status || 'not_checked',
        ocrExtractedPeriod: ocrResult?.extractedPeriod || null,
        movementStatus: movementStatus?.value || 'nao_informado',
      });
    });

    document.body.appendChild(backdrop);
  });
}
