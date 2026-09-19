import { STATE, companyName, activeOccurrences, isManager, canAccessModule } from '../state.js';
import {
  CATEGORIES, ADMINISTRATIVE_MODULES, MONTH_NAMES, MONTH_FULL, PRIORITIES, DAY_TYPES, BUSINESS_DAY_SHIFTS,
} from '../constants.js';
import { escapeHtml } from '../dateUtils.js';
import { doSaveObligation, doDeleteObligation, doLoadComments, doAddComment, doDeleteComment, doLoadChecklist, doAddChecklistItem, doDeleteChecklistItem } from '../data.js';
import { validatorFieldHtml, bindValidatorField, readValidatorField } from './validatorField.js';
import { suggestChecklist } from '../checklistSuggestions.js?v=20260814-sankhya-checklists-v1';

let onSavedCallback = null;

export function closeModal() {
  document.getElementById('modalBackdrop').setAttribute('hidden', '');
  STATE.editingId = null;
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

export function openModal(editId, { onSaved } = {}) {
  onSavedCallback = onSaved || null;
  STATE.editingId = editId || null;
  const existing = editId ? STATE.obligations.find((o) => o.id === editId) : null;
  const isEdit = !!existing;

  const ob = existing || {
    id: null,
    name: '',
    category: 'federal',
    frequency: 'mensal',
    responsible: '',
    responsible_id: null,
    company_id: STATE.companies[0]?.id || null,
    day_of_month: 10,
    month: 1,
    months: [3, 6, 9, 12],
    due_date: '',
    notes: '',
    priority: 'media',
    business_day_shift: 'nenhum',
    day_type: 'fixo',
  };
  const empresaNomeAtual = existing ? companyName(existing.company_id) : (STATE.companies[0]?.name || '');

  const monthsChips = MONTH_NAMES.map((m, i) => {
    const n = i + 1;
    const sel = (ob.months || []).includes(n);
    return `<div class="month-chip ${sel ? 'sel' : ''}" data-month="${n}">${m}</div>`;
  }).join('');

  const catOptions = CATEGORIES.map((c) => `<option value="${c.key}" ${ob.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('');
  const moduleOptions = ADMINISTRATIVE_MODULES.filter((module) => canAccessModule(module.key))
    .map((module) => `<option value="${module.key}" ${(ob.module_key || 'fiscal') === module.key ? 'selected' : ''}>${module.label}</option>`).join('');
  const monthFullOptions = MONTH_FULL.map((m, i) => `<option value="${i + 1}" ${ob.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('');

  let html = `<h2>${isEdit ? 'Editar atividade' : 'Nova atividade'}</h2>`;

  // Só ao criar (não ao editar uma obrigação existente): escolher uma regra
  // do catálogo (Gerenciar → Regras) só PRÉ-PREENCHE os campos abaixo — não
  // cria vínculo nenhum entre a obrigação e a regra depois de salva.
  if (!isEdit && STATE.obligationRules.length) {
    const ruleOptions = STATE.obligationRules.slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    html += '<div class="field"><label>Usar modelo de mercado (opcional)</label>'
      + `<select id="fUseRule"><option value="">— Nenhum, preencher manualmente —</option>${ruleOptions}</select>`
      + '</div>';
  }

  html += `<div class="field"><label>Nome da atividade</label><input id="fName" type="text" value="${escapeHtml(ob.name)}" placeholder="Ex.: DCTFWeb" /></div>`;
  html += `<div class="field"><label>Módulo da área</label><select id="fModule">${moduleOptions}</select><small>Define em qual área administrativa a atividade será exibida.</small></div>`;
  html += '<div class="field"><label>Tipo de atividade</label><select id="fActivityType">'
    + `<option value="obrigacao_acessoria" ${(ob.activity_type || 'obrigacao_acessoria') === 'obrigacao_acessoria' ? 'selected' : ''}>Obrigação acessória</option>`
    + `<option value="rotina" ${ob.activity_type === 'rotina' ? 'selected' : ''}>Rotina operacional</option>`
    + `<option value="tarefa" ${ob.activity_type === 'tarefa' ? 'selected' : ''}>Tarefa</option>`
    + `<option value="marco" ${ob.activity_type === 'marco' ? 'selected' : ''}>Marco do processo</option></select></div>`;
  html += `<div class="field"><label>Processo</label><input id="fProcessName" value="${escapeHtml(ob.process_name || '')}" placeholder="Ex.: Fechamento fiscal mensal" /></div>`;
  const predecessorOptions = STATE.obligations.filter((item) => item.id !== ob.id)
    .map((item) => `<option value="${item.id}" ${ob.predecessor_id === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  html += `<div class="field"><label>Atividade anterior na esteira (opcional)</label><select id="fPredecessor"><option value="">— Início do processo —</option>${predecessorOptions}</select></div>`;
  html += `<div class="field" id="accessoryCategoryField"><label>Categoria da obrigação acessória</label><select id="fCategory">${catOptions}</select><small>Usada somente quando o tipo for “Obrigação acessória”.</small></div>`;
  html += `<div class="field"><label>Empresa</label><input id="fEmpresa" type="text" list="empresaList" value="${escapeHtml(empresaNomeAtual)}" placeholder="Ex.: GRA" />`;
  html += `<datalist id="empresaList">${STATE.companies.map((c) => `<option value="${escapeHtml(c.name)}">`).join('')}</datalist></div>`;

  const teamProfiles = STATE.profiles.slice().sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));
  const isOtherResponsible = !ob.responsible_id && !!ob.responsible;

  // Carga atual de cada pessoa (quantas obrigações com ocorrência ativa —
  // ainda não concluída — já estão no nome dela), para apoiar a escolha de
  // responsável na hora de cadastrar. Só informa; a escolha continua manual.
  const workloadByProfile = new Map();
  activeOccurrences().forEach((it) => {
    if (!it.ob.responsible_id || !it.active) return;
    workloadByProfile.set(it.ob.responsible_id, (workloadByProfile.get(it.ob.responsible_id) || 0) + 1);
  });

  const responsibleOptions = '<option value="">Sem responsável definido</option>'
    + teamProfiles.map((p) => {
      const load = workloadByProfile.get(p.id) || 0;
      const label = `${p.display_name || p.email} — ${load} pendente${load === 1 ? '' : 's'}`;
      return `<option value="${p.id}" ${ob.responsible_id === p.id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('')
    + `<option value="__other__" ${isOtherResponsible ? 'selected' : ''}>Outro (não está na equipe do sistema)</option>`;
  html += '<div class="field"><label>Responsável</label>'
    + `<select id="fResponsibleSelect">${responsibleOptions}</select>`
    + `<input id="fResponsibleOther" type="text" placeholder="Nome da pessoa" value="${escapeHtml(isOtherResponsible ? ob.responsible : '')}" style="margin-top:7px;" class="${isOtherResponsible ? '' : 'hidden'}" />`
    + '</div>';

  html += '<div class="field"><label>Frequência</label><select id="fFrequency">'
    + `<option value="diaria" ${ob.frequency === 'diaria' ? 'selected' : ''}>Diária (todos os dias)</option>`
    + `<option value="mensal" ${ob.frequency === 'mensal' ? 'selected' : ''}>Mensal</option>`
    + `<option value="trimestral" ${ob.frequency === 'trimestral' ? 'selected' : ''}>Trimestral</option>`
    + `<option value="anual" ${ob.frequency === 'anual' ? 'selected' : ''}>Anual</option>`
    + `<option value="pontual" ${ob.frequency === 'pontual' ? 'selected' : ''}>Pontual (data única)</option>`
    + '</select></div>';

  const priorityOptions = PRIORITIES.map((p) => `<option value="${p.key}" ${ob.priority === p.key ? 'selected' : ''}>${p.label}</option>`).join('');
  html += `<div class="field"><label>Prioridade</label><select id="fPriority">${priorityOptions}</select></div>`;
  html += `<div class="field"><label><input id="fRequiresAttachment" type="checkbox" ${(ob.requires_attachment !== false) ? 'checked' : ''} style="width:auto" /> Exigir comprovante na conclusão</label></div>`;
  html += `<div class="field" id="noMovementReceiptField"><label><input id="fRequiresAttachmentNoMovement" type="checkbox" ${(ob.requires_attachment_no_movement !== false) ? 'checked' : ''} style="width:auto" /> Exigir comprovante também quando a empresa estiver sem movimento</label></div>`;
  html += validatorFieldHtml(
    { ...ob, requires_validation: ob.requires_validation !== false },
    STATE.profiles,
    isManager() || !isEdit,
  );

  const dayTypeOptions = DAY_TYPES.map((d) => `<option value="${d.key}" ${ob.day_type === d.key ? 'selected' : ''}>${d.label}</option>`).join('');
  html += `<div class="field freq-day-type"><label>Como contar o dia do vencimento</label><select id="fDayType">${dayTypeOptions}</select></div>`;

  html += `<div class="field freq-mensal"><label id="fDayMensalLabel">Dia do vencimento (mensal)</label><input id="fDayMensal" type="number" min="1" max="31" value="${ob.day_of_month || 10}" /></div>`;
  html += `<div class="field freq-trimestral"><label id="fDayTriLabel">Dia do vencimento</label><input id="fDayTri" type="number" min="1" max="31" value="${ob.day_of_month || 10}" /></div>`;
  html += `<div class="field freq-trimestral"><label>Meses de vencimento</label><div class="months-grid" id="monthsGrid">${monthsChips}</div></div>`;
  html += `<div class="field freq-anual"><label>Mês</label><select id="fMonth">${monthFullOptions}</select></div>`;
  html += `<div class="field freq-anual"><label id="fDayAnualLabel">Dia</label><input id="fDayAnual" type="number" min="1" max="31" value="${ob.day_of_month || 10}" /></div>`;
  html += `<div class="field freq-pontual"><label>Data</label><input id="fDate" type="date" value="${ob.due_date || ''}" /></div>`;

  const businessDayShiftOptions = BUSINESS_DAY_SHIFTS.map((s) => `<option value="${s.key}" ${(ob.business_day_shift || 'nenhum') === s.key ? 'selected' : ''}>${s.label}</option>`).join('');
  html += `<div class="field"><label>Se cair num fim de semana ou feriado</label><select id="fBusinessDayShift">${businessDayShiftOptions}</select></div>`;

  html += `<div class="field"><label>Observações (opcional)</label><textarea id="fNotes" placeholder="Ex.: confirmar prazo no calendário RFB antes do envio">${escapeHtml(ob.notes || '')}</textarea></div>`;

  if (isEdit) {
    html += '<div class="field"><label>Comentários</label>'
      + '<div id="commentsList" class="comments-list"><p class="comments-loading">Carregando…</p></div>'
      + '<div class="comment-add-row">'
        + '<input type="text" id="fNewComment" placeholder="Escrever um comentário…" />'
        + '<button type="button" class="btn-ghost" data-action="add-comment">Enviar</button>'
      + '</div>'
    + '</div>';

    html += '<div class="field"><label>Checklist (passos para concluir)</label>'
      + '<div id="checklistList" class="comments-list"><p class="comments-loading">Carregando…</p></div>'
      + '<div class="checklist-ai">'
        + '<div><strong>Sugestões inteligentes</strong><small>Combina checklists da equipe, modelo de linguagem e conteúdo de fontes oficiais. Revise antes de adicionar.</small></div>'
        + '<button type="button" class="btn-ghost" data-action="suggest-checklist">Sugerir checklist</button>'
      + '</div>'
      + '<div id="checklistSuggestions" class="checklist-suggestions" hidden></div>'
      + '<div class="comment-add-row">'
        + '<input type="text" id="fNewChecklistItem" placeholder="Novo passo do checklist…" />'
        + '<button type="button" class="btn-ghost" data-action="add-checklist-item">Adicionar</button>'
      + '</div>'
    + '</div>';
  }

  html += '<div class="modal-actions">';
  html += `<div>${isEdit ? `<button class="btn-danger-text" data-action="delete-in-modal" data-id="${ob.id}">Excluir</button>` : ''}</div>`;
  html += `<div class="right"><button class="btn-ghost" data-action="close">Cancelar</button><button class="btn-primary" id="modalSaveBtn" data-action="save" data-id="${ob.id || ''}">Salvar</button></div>`;
  html += '</div>';

  const modalEl = document.getElementById('modal');
  modalEl.innerHTML = html;
  document.getElementById('modalBackdrop').removeAttribute('hidden');
  toggleFreqFields(ob.frequency);

  const freqSel = document.getElementById('fFrequency');
  const activityTypeSel = document.getElementById('fActivityType');
  const toggleNoMovementField = () => document.getElementById('noMovementReceiptField')?.classList.toggle('hidden', activityTypeSel.value !== 'obrigacao_acessoria');
  const toggleCategoryField = () => document.getElementById('accessoryCategoryField')?.classList.toggle('hidden', activityTypeSel.value !== 'obrigacao_acessoria');
  activityTypeSel.addEventListener('change', () => { toggleNoMovementField(); toggleCategoryField(); });
  toggleNoMovementField();
  toggleCategoryField();
  bindValidatorField();
  freqSel.addEventListener('change', () => toggleFreqFields(freqSel.value));

  const dayTypeSel = document.getElementById('fDayType');
  function updateDayLabels() {
    const isUtil = dayTypeSel.value === 'util_do_mes';
    const text = isUtil ? 'Qual dia útil (ex.: 3 = 3º dia útil)' : 'Dia do vencimento';
    ['fDayMensalLabel', 'fDayTriLabel', 'fDayAnualLabel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }
  dayTypeSel.addEventListener('change', updateDayLabels);
  updateDayLabels();

  const useRuleSel = document.getElementById('fUseRule');
  if (useRuleSel) {
    useRuleSel.addEventListener('change', () => {
      const rule = STATE.obligationRules.find((r) => r.id === useRuleSel.value);
      if (!rule) return;

      document.getElementById('fName').value = rule.name;
      document.getElementById('fCategory').value = rule.category;
      freqSel.value = rule.frequency;
      toggleFreqFields(rule.frequency);
      dayTypeSel.value = rule.day_type;
      updateDayLabels();

      const dayVal = rule.day_of_month || 10;
      ['fDayMensal', 'fDayTri', 'fDayAnual'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = dayVal;
      });
      if (rule.month) document.getElementById('fMonth').value = rule.month;
      document.querySelectorAll('#monthsGrid .month-chip').forEach((chip) => {
        const n = parseInt(chip.getAttribute('data-month'), 10);
        chip.classList.toggle('sel', (rule.months || []).includes(n));
      });

      document.getElementById('fBusinessDayShift').value = rule.business_day_shift || 'nenhum';
      if (rule.notes) document.getElementById('fNotes').value = rule.notes;
    });
  }

  const respSel = document.getElementById('fResponsibleSelect');
  const respOther = document.getElementById('fResponsibleOther');
  respSel.addEventListener('change', () => {
    respOther.classList.toggle('hidden', respSel.value !== '__other__');
    if (respSel.value === '__other__') respOther.focus();
  });

  const grid = document.getElementById('monthsGrid');
  grid.addEventListener('click', (e) => {
    const chip = e.target.closest('.month-chip');
    if (!chip) return;
    chip.classList.toggle('sel');
  });

  modalEl.querySelector('[data-action="close"]').addEventListener('click', closeModal);
  if (isEdit) {
    modalEl.querySelector('[data-action="delete-in-modal"]').addEventListener('click', () => {
      const id = existing.id;
      closeModal();
      doDeleteObligation(id, () => onSavedCallback?.());
    });
    wireComments(existing.id);
    wireChecklist(existing);
  }
  modalEl.querySelector('[data-action="save"]').addEventListener('click', () => handleSave(existing?.id || null));
}

function renderCommentsList(comments) {
  if (!comments.length) return '<p class="comments-empty">Nenhum comentário ainda.</p>';
  return comments.map((c) => {
    const canDelete = c.author_id === STATE.session?.id || STATE.profile?.role === 'admin';
    const when = new Date(c.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    return '<div class="comment-item">'
      + `<div class="comment-meta"><strong>${escapeHtml(c.author_name)}</strong> · ${when}${canDelete ? ` · <button type="button" class="comment-delete" data-comment-id="${c.id}">excluir</button>` : ''}</div>`
      + `<div class="comment-body">${escapeHtml(c.body)}</div>`
    + '</div>';
  }).join('');
}

async function wireComments(obligationId) {
  const listEl = document.getElementById('commentsList');

  async function reload() {
    const comments = await doLoadComments(obligationId);
    if (!document.getElementById('commentsList')) return; // modal já fechou
    listEl.innerHTML = renderCommentsList(comments);
    listEl.querySelectorAll('.comment-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        doDeleteComment(btn.getAttribute('data-comment-id'), reload);
      });
    });
  }
  reload();

  const addBtn = document.querySelector('[data-action="add-comment"]');
  const input = document.getElementById('fNewComment');
  async function submit() {
    const body = input.value.trim();
    if (!body) return;
    addBtn.disabled = true;
    await doAddComment(obligationId, body, () => { input.value = ''; reload(); });
    addBtn.disabled = false;
  }
  addBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function renderChecklistDisplayList(items) {
  if (!items.length) return '<p class="comments-empty">Nenhum passo cadastrado ainda. Se ficar vazio, a conclusão não exige nenhum item marcado.</p>';
  return items.map((it) => (
    '<div class="comment-item">'
      + `<div class="comment-body">${escapeHtml(it.description)} <button type="button" class="comment-delete" data-item-id="${it.id}">excluir</button></div>`
    + '</div>'
  )).join('');
}

async function wireChecklist(obligation) {
  const obligationId = obligation.id;
  const listEl = document.getElementById('checklistList');

  async function reload() {
    const items = await doLoadChecklist(obligationId);
    if (!document.getElementById('checklistList')) return; // modal já fechou
    listEl.innerHTML = renderChecklistDisplayList(items);
    listEl.querySelectorAll('.comment-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        doDeleteChecklistItem(btn.getAttribute('data-item-id'), reload);
      });
    });
  }
  reload();

  const addBtn = document.querySelector('[data-action="add-checklist-item"]');
  const input = document.getElementById('fNewChecklistItem');
  async function submit() {
    const description = input.value.trim();
    if (!description) return;
    addBtn.disabled = true;
    const current = await doLoadChecklist(obligationId);
    await doAddChecklistItem(obligationId, description, current.length, () => { input.value = ''; reload(); });
    addBtn.disabled = false;
  }
  addBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const suggestBtn = document.querySelector('[data-action="suggest-checklist"]');
  const suggestionsEl = document.getElementById('checklistSuggestions');
  suggestBtn.addEventListener('click', async () => {
    suggestBtn.disabled = true;
    suggestBtn.textContent = 'Analisando…';
    suggestionsEl.hidden = false;
    suggestionsEl.innerHTML = '<p class="comments-loading">Consultando histórico e fontes disponíveis…</p>';
    const result = await suggestChecklist(obligation, STATE.obligations, STATE.checklistItems);
    const current = await doLoadChecklist(obligationId);
    const existingDescriptions = new Set(current.map((item) => item.description.trim().toLowerCase()));
    const available = result.suggestions.filter((item) => !existingDescriptions.has(item.description.trim().toLowerCase()));
    suggestionsEl.innerHTML = available.length
      ? `<div class="suggestion-meta"><strong>${escapeHtml(result.mode)}</strong><span>${available.length} sugestão(ões) — nenhuma é adicionada automaticamente.</span></div>`
        + available.map((item, index) => `<label class="suggestion-item"><input type="checkbox" value="${index}" checked><span>${escapeHtml(item.description)}<small>${escapeHtml(item.origin || 'Sugestão inteligente')}</small></span></label>`).join('')
        + '<button type="button" class="btn-primary suggestion-add">Adicionar selecionadas</button>'
        + (result.sources.length ? `<p class="suggestion-sources">Fontes consultadas: ${result.sources.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">fonte oficial</a>`).join(' · ')}</p>` : '')
        + '<p class="suggestion-warning">A sugestão pode conter erros. Confirme procedimentos e prazos nos canais oficiais.</p>'
      : '<p class="comments-empty">Não há novas sugestões para este checklist.</p>';
    suggestionsEl.querySelector('.suggestion-add')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const selected = [...suggestionsEl.querySelectorAll('input:checked')].map((box) => available[Number(box.value)]).filter(Boolean);
      let position = current.length;
      for (const item of selected) {
        await doAddChecklistItem(obligationId, item.description, position);
        position += 1;
      }
      await reload();
      suggestionsEl.hidden = true;
    });
    suggestBtn.disabled = false;
    suggestBtn.textContent = 'Sugerir novamente';
  });
}

function toggleFreqFields(freq) {
  ['diaria', 'mensal', 'trimestral', 'anual', 'pontual'].forEach((f) => {
    document.querySelectorAll(`.freq-${f}`).forEach((el) => el.classList.toggle('hidden', f !== freq));
  });
  document.querySelectorAll('.freq-day-type').forEach((el) => el.classList.toggle('hidden', ['diaria', 'pontual'].includes(freq)));
  document.getElementById('fBusinessDayShift')?.closest('.field')?.classList.toggle('hidden', freq === 'diaria');
}

function readModalForm() {
  const name = document.getElementById('fName').value.trim();
  if (!name) return { error: 'Informe o nome da atividade.' };

  const category = document.getElementById('fCategory').value;
  const empresaNome = document.getElementById('fEmpresa').value.trim();
  const frequency = document.getElementById('fFrequency').value;
  const notes = document.getElementById('fNotes').value.trim();

  const respSelValue = document.getElementById('fResponsibleSelect').value;
  let responsible = '';
  let responsible_id = null;
  if (respSelValue === '__other__') {
    responsible = document.getElementById('fResponsibleOther').value.trim();
    if (!responsible) return { error: 'Informe o nome do responsável, ou escolha "Sem responsável definido".' };
  } else if (respSelValue) {
    const person = STATE.profiles.find((p) => p.id === respSelValue);
    responsible_id = respSelValue;
    responsible = person?.display_name || person?.email || '';
  }

  const form = {
    name, category, empresaNome, responsible, responsible_id, frequency, notes,
    module_key: document.getElementById('fModule').value,
    priority: document.getElementById('fPriority').value,
    business_day_shift: document.getElementById('fBusinessDayShift')?.value || 'nenhum',
    day_type: document.getElementById('fDayType')?.value || 'fixo',
    sourceRuleId: document.getElementById('fUseRule')?.value || null,
    day_of_month: null, month: null, months: null, due_date: null,
    activity_type: document.getElementById('fActivityType').value,
    process_name: document.getElementById('fProcessName').value.trim(),
    area_name: '',
    predecessor_id: document.getElementById('fPredecessor').value || null,
    requires_attachment: document.getElementById('fRequiresAttachment').checked,
    requires_attachment_no_movement: document.getElementById('fRequiresAttachmentNoMovement').checked,
  };
  const validation = readValidatorField();
  if (validation.requires_validation && !validation.validator_id) {
    return { error: 'A Gestão deve escolher quem validará esta tarefa.' };
  }
  Object.assign(form, validation);

  if (frequency === 'diaria') {
    form.day_type = 'fixo';
    form.business_day_shift = 'nenhum';
  } else if (frequency === 'mensal') {
    form.day_of_month = Math.max(1, Math.min(31, parseInt(document.getElementById('fDayMensal').value, 10) || 1));
  } else if (frequency === 'trimestral') {
    form.day_of_month = Math.max(1, Math.min(31, parseInt(document.getElementById('fDayTri').value, 10) || 1));
    const sel = Array.from(document.querySelectorAll('#monthsGrid .month-chip.sel')).map((c) => parseInt(c.getAttribute('data-month'), 10));
    if (!sel.length) return { error: 'Selecione ao menos um mês de vencimento.' };
    form.months = sel;
  } else if (frequency === 'anual') {
    form.month = parseInt(document.getElementById('fMonth').value, 10);
    form.day_of_month = Math.max(1, Math.min(31, parseInt(document.getElementById('fDayAnual').value, 10) || 1));
  } else if (frequency === 'pontual') {
    const dateVal = document.getElementById('fDate').value;
    if (!dateVal) return { error: 'Informe a data.' };
    form.due_date = dateVal;
  }

  return { form };
}

async function handleSave(id) {
  const { form, error } = readModalForm();
  if (error) { showFieldError(error); return; }
  clearFieldError();

  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  await doSaveObligation(id, form, (saved) => {
    closeModal();
    onSavedCallback?.(saved);
  });

  if (document.getElementById('modalSaveBtn')) {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}
