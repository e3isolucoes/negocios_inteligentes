import { STATE } from '../state.js';
import {
  CATEGORIES, MONTH_NAMES, MONTH_FULL, DAY_TYPES, BUSINESS_DAY_SHIFTS,
} from '../constants.js';
import { escapeHtml } from '../dateUtils.js';
import { doSaveRule, doDeleteRule } from '../data.js';

// Modal de CRUD do catálogo de regras (modelos de mercado) — reaproveita o
// mesmo #modal/#modalBackdrop do modal de obrigação (ui/modal.js), mas com
// seu próprio estado (STATE.editingRuleId) e ações (data-action="rule-*")
// para não colidir com ele; só um dos dois fica com conteúdo por vez.

let onSavedCallback = null;

export function closeRuleModal() {
  document.getElementById('modalBackdrop').setAttribute('hidden', '');
  STATE.editingRuleId = null;
}

function clearFieldError() {
  document.getElementById('modalFieldError')?.remove();
}

function showFieldError(message) {
  clearFieldError();
  const actions = document.querySelector('#modal .modal-actions');
  const el = document.createElement('p');
  el.id = 'modalFieldError';
  el.className = 'field-error';
  el.textContent = message;
  actions.before(el);
}

function toggleFreqFieldsRule(freq) {
  document.querySelectorAll('.freq-anual-rule').forEach((el) => el.classList.toggle('hidden', freq !== 'anual'));
  document.querySelectorAll('.freq-trimestral-rule').forEach((el) => el.classList.toggle('hidden', freq !== 'trimestral'));
}

export function openRuleModal(editId, { onSaved } = {}) {
  onSavedCallback = onSaved || null;
  STATE.editingRuleId = editId || null;
  const existing = editId ? STATE.obligationRules.find((r) => r.id === editId) : null;
  const isEdit = !!existing;

  const rule = existing || {
    id: null,
    name: '',
    category: 'federal',
    frequency: 'mensal',
    day_type: 'fixo',
    day_of_month: 10,
    month: 1,
    months: [3, 6, 9, 12],
    business_day_shift: 'nenhum',
    notes: '',
    checklist_template: [],
  };

  const monthsChips = MONTH_NAMES.map((m, i) => {
    const n = i + 1;
    const sel = (rule.months || []).includes(n);
    return `<div class="month-chip ${sel ? 'sel' : ''}" data-month="${n}">${m}</div>`;
  }).join('');

  const catOptions = CATEGORIES.map((c) => `<option value="${c.key}" ${rule.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('');
  const monthFullOptions = MONTH_FULL.map((m, i) => `<option value="${i + 1}" ${rule.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
  const dayTypeOptions = DAY_TYPES.map((d) => `<option value="${d.key}" ${rule.day_type === d.key ? 'selected' : ''}>${d.label}</option>`).join('');

  let html = `<h2>${isEdit ? 'Editar regra' : 'Nova regra'}</h2>`;
  html += '<div class="empty" style="text-align:left;padding:10px 12px;margin-bottom:13px;font-size:12.5px;">'
    + 'Isso cadastra um <strong>modelo</strong> reutilizável (catálogo de mercado), não uma obrigação de uma empresa '
    + 'específica. Ao criar uma obrigação nova, dá para escolher esta regra para pré-preencher o formulário.'
    + '</div>';
  html += `<div class="field"><label>Nome</label><input id="rName" type="text" value="${escapeHtml(rule.name)}" placeholder="Ex.: DCTFWeb" /></div>`;
  html += `<div class="field"><label>Categoria</label><select id="rCategory">${catOptions}</select></div>`;
  html += '<div class="field"><label>Frequência</label><select id="rFrequency">'
    + `<option value="mensal" ${rule.frequency === 'mensal' ? 'selected' : ''}>Mensal</option>`
    + `<option value="trimestral" ${rule.frequency === 'trimestral' ? 'selected' : ''}>Trimestral</option>`
    + `<option value="anual" ${rule.frequency === 'anual' ? 'selected' : ''}>Anual</option>`
    + '</select></div>';
  html += `<div class="field"><label>Como contar o dia do vencimento</label><select id="rDayType">${dayTypeOptions}</select></div>`;
  html += `<div class="field"><label id="rDayLabel">Dia do vencimento</label><input id="rDay" type="number" min="1" max="31" value="${rule.day_of_month || 10}" /></div>`;
  html += `<div class="field freq-anual-rule"><label>Mês</label><select id="rMonth">${monthFullOptions}</select></div>`;
  html += `<div class="field freq-trimestral-rule"><label>Meses de vencimento</label><div class="months-grid" id="rMonthsGrid">${monthsChips}</div></div>`;
  const businessDayShiftOptionsRule = BUSINESS_DAY_SHIFTS.map((s) => `<option value="${s.key}" ${(rule.business_day_shift || 'nenhum') === s.key ? 'selected' : ''}>${s.label}</option>`).join('');
  html += `<div class="field"><label>Se cair num fim de semana ou feriado</label><select id="rBusinessDayShift">${businessDayShiftOptionsRule}</select></div>`;
  html += `<div class="field"><label>Observações</label><textarea id="rNotes" placeholder="Ex.: confirme o prazo no calendário oficial vigente">${escapeHtml(rule.notes || '')}</textarea></div>`;
  html += '<div class="field"><label>Checklist padrão (um passo por linha, opcional)</label>'
    + `<textarea id="rChecklistTemplate" placeholder="Ex.: Conferir apuração no sistema&#10;Gerar guia&#10;Anexar comprovante">${escapeHtml((rule.checklist_template || []).join('\n'))}</textarea>`
    + '<p class="mgmt-sub" style="margin-top:4px;">Copiado para o checklist de cada obrigação criada a partir deste modelo (manual ou automaticamente por um regime tributário).</p>'
  + '</div>';

  html += '<div class="modal-actions">';
  html += `<div>${isEdit ? `<button class="btn-danger-text" data-action="rule-delete-in-modal" data-id="${rule.id}">Excluir</button>` : ''}</div>`;
  html += `<div class="right"><button class="btn-ghost" data-action="rule-close">Cancelar</button><button class="btn-primary" id="ruleSaveBtn" data-action="rule-save" data-id="${rule.id || ''}">Salvar</button></div>`;
  html += '</div>';

  const modalEl = document.getElementById('modal');
  modalEl.innerHTML = html;
  document.getElementById('modalBackdrop').removeAttribute('hidden');
  toggleFreqFieldsRule(rule.frequency);

  const freqSel = document.getElementById('rFrequency');
  freqSel.addEventListener('change', () => toggleFreqFieldsRule(freqSel.value));

  const dayTypeSel = document.getElementById('rDayType');
  function updateDayLabel() {
    document.getElementById('rDayLabel').textContent = dayTypeSel.value === 'util_do_mes'
      ? 'Qual dia útil (ex.: 3 = 3º dia útil)'
      : 'Dia do vencimento';
  }
  dayTypeSel.addEventListener('change', updateDayLabel);
  updateDayLabel();

  const grid = document.getElementById('rMonthsGrid');
  grid.addEventListener('click', (e) => {
    const chip = e.target.closest('.month-chip');
    if (!chip) return;
    chip.classList.toggle('sel');
  });

  modalEl.querySelector('[data-action="rule-close"]').addEventListener('click', closeRuleModal);
  if (isEdit) {
    modalEl.querySelector('[data-action="rule-delete-in-modal"]').addEventListener('click', () => {
      const id = existing.id;
      closeRuleModal();
      doDeleteRule(id, () => onSavedCallback?.());
    });
  }
  modalEl.querySelector('[data-action="rule-save"]').addEventListener('click', () => handleSaveRule(existing?.id || null));
}

function readRuleForm() {
  const name = document.getElementById('rName').value.trim();
  if (!name) return { error: 'Informe o nome da regra.' };

  const category = document.getElementById('rCategory').value;
  const frequency = document.getElementById('rFrequency').value;
  const day_type = document.getElementById('rDayType').value;
  const notes = document.getElementById('rNotes').value.trim();
  const business_day_shift = document.getElementById('rBusinessDayShift').value;
  const day_of_month = Math.max(1, Math.min(31, parseInt(document.getElementById('rDay').value, 10) || 1));
  const checklist_template = document.getElementById('rChecklistTemplate').value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const form = {
    name, category, frequency, day_type, day_of_month, business_day_shift, notes, checklist_template, month: null, months: null,
  };

  if (frequency === 'anual') {
    form.month = parseInt(document.getElementById('rMonth').value, 10);
  } else if (frequency === 'trimestral') {
    const sel = Array.from(document.querySelectorAll('#rMonthsGrid .month-chip.sel')).map((c) => parseInt(c.getAttribute('data-month'), 10));
    if (!sel.length) return { error: 'Selecione ao menos um mês de vencimento.' };
    form.months = sel;
  }

  return { form };
}

async function handleSaveRule(id) {
  const { form, error } = readRuleForm();
  if (error) { showFieldError(error); return; }
  clearFieldError();

  const btn = document.getElementById('ruleSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  await doSaveRule(id, form, (saved) => {
    closeRuleModal();
    onSavedCallback?.(saved);
  });

  if (document.getElementById('ruleSaveBtn')) {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}
