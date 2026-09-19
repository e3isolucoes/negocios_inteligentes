import { STATE, isAdmin, isManager, isSuperUser, activeOccurrences } from './state.js';
import { escapeHtml, deltaLabel } from './dateUtils.js';
import { renderToolbar } from './ui/toolbar.js';
import { selecionarVisaoExecutiva } from './ui/executiveView.js';
import { openModal, closeModal } from './ui/modal.js?v=20260814-access-roles-v1';
import { openRuleModal } from './ui/ruleModal.js';
import {
  doMarkDone, doUndoLast, doDeleteObligation, loadAll,
  doCreateCompany, doRenameCompany, doDeleteCompany, doChangeRole, doSetUserActive, doSendPasswordReset, doImportObligations,
  doLoadAuditLog, doAddHoliday, doDeleteHoliday, doImportNationalHolidays, doDeleteRule,
  doAdjustOccurrenceDate, doApplyRuleToCompanies, doCreateUser, doChangeUserWorkspace,
  doOpenRegimeDialog, doDeleteTaxRegime, doOpenRegimeRulesDialog, doOpenRegimeCompaniesDialog,
  doApplyRegimeToCompany, doToggleChecklistItem,
  doCreateWorkspace, doUpdateWorkspaceAccess,
} from './data.js?v=20260830-modular-v1';
import { signOut } from './api/auth.js';
import { parseCsvFile, validateImportRows, downloadCsvTemplate } from './csv.js';
import { getAttachmentUrl } from './api/storage.js';
import { showToast } from './ui/toast.js';
import { resolveView } from './modules/catalog.js';

let appClickBound = false;
let appChangeBound = false;

// Senha temporária legível (sem 0/O/1/l/I, pra não confundir na hora de
// digitar/repassar) — só um ponto de partida; a pessoa pode trocar depois.
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function renderConnBanner() {
  if (!STATE.connectionError) return '';
  return `<div class="conn-banner"><span>${escapeHtml(STATE.connectionError)}</span><button type="button" data-action="retry-load">Tentar de novo</button></div>`;
}

// Obrigações vinculadas à conta logada que estão atrasadas ou vencendo em
// breve — a mesma informação que "Minhas obrigações" já mostra, só que
// resumida num sino no topo, para avisar sem precisar trocar de aba.
function myUrgentItems() {
  if (!STATE.session) return [];
  return activeOccurrences()
    .filter((it) => it.ob.responsible_id === STATE.session.id && (it.status.tone === 'red' || it.status.tone === 'amber'))
    .sort((a, b) => {
      const da = a.displayDate ? a.displayDate.getTime() : Infinity;
      const db = b.displayDate ? b.displayDate.getTime() : Infinity;
      return da - db;
    });
}

function renderNotificationBell() {
  const items = myUrgentItems();
  const pendingValidation = STATE.validation?.pending || 0;
  const rejected = STATE.validation?.rejected || 0;
  const count = items.length + pendingValidation + rejected;

  // Validação entra no sino porque, sem aviso, a fila trava sem ninguém
  // perceber — e uma tarefa devolvida é tão urgente quanto uma atrasada.
  let listHtml = '';

  if (rejected) {
    listHtml += '<div class="dd-item" data-action="tab" data-tab="validacoes" style="white-space:normal;">'
      + `<span class="status-pill tone-red" style="margin-right:6px;">Devolvida</span>`
      + `${rejected} tarefa(s) voltaram para você corrigir`
      + '</div>';
  }
  if (pendingValidation) {
    listHtml += '<div class="dd-item" data-action="tab" data-tab="validacoes" style="white-space:normal;">'
      + `<span class="status-pill tone-amber" style="margin-right:6px;">Validar</span>`
      + `${pendingValidation} tarefa(s) aguardando sua validação`
      + '</div>';
  }

  listHtml += items.length
    ? items.slice(0, 8).map(({ ob, status }) => (
      '<div class="dd-item" style="white-space:normal;cursor:default;">'
        + `<span class="status-pill tone-${status.tone}" style="margin-right:6px;">${escapeHtml(status.label)}</span>`
        + `${escapeHtml(ob.name)} — ${deltaLabel(status.diffDays)}`
      + '</div>'
    )).join('')
    : (count ? '' : '<div class="dd-item" style="white-space:normal;cursor:default;">Nenhuma pendência sua atrasada ou vencendo em breve.</div>');

  return '<div class="dd" data-dd-root="notifications">'
    + '<button type="button" class="dd-btn" data-action="dd-toggle" data-dd="notifications" aria-label="Notificações" title="Suas obrigações atrasadas, vencendo em breve ou aguardando validação">'
      + `🔔${count ? ` <span class="status-pill tone-red">${count}</span>` : ''}`
    + '</button>'
    + '<div class="dd-panel hidden" data-dd-panel="notifications" style="left:auto;right:0;">'
      + listHtml
      + (items.length ? '<div class="dd-item" data-action="tab" data-tab="mine" style="font-weight:700;text-align:center;">Ver Minhas obrigações →</div>' : '')
    + '</div>'
  + '</div>';
}

function bodyForView() {
  return resolveView(STATE.view).render();
}

export function render() {
  const app = document.getElementById('app');
  const body = bodyForView();
  const roleLabel = isSuperUser() ? 'Superusuário' : (isAdmin() ? 'Admin' : (isManager() ? 'Gestor' : 'Membro'));

  app.innerHTML = '<header class="topbar">'
    + '<div class="brand"><img class="app-brand-logo" src="icons/e3l-solucoes.svg" alt="E3I Soluções"><div><span class="product-name">E3I Soluções</span><h1>Painel de Obrigações</h1><p class="sub">Controladoria · acompanhamento compartilhado da equipe</p></div></div>'
    + `<div class="who-am-i">${renderNotificationBell()}<span class="user-avatar" aria-hidden="true">${escapeHtml((STATE.profile?.display_name || STATE.session?.email || 'U').trim().charAt(0).toUpperCase())}</span><span class="user-copy"><span class="email">${escapeHtml(STATE.profile?.display_name || STATE.session?.email || '')}</span><span class="role-badge ${isManager() ? 'admin' : ''}">${roleLabel}</span></span><button class="logout-btn" id="logoutBtn" type="button" aria-label="Sair da conta">Sair</button></div>`
    + '</header>'
    + renderConnBanner()
    + renderToolbar()
    + `<section class="board">${body}</section>`
    + '<footer class="foot"><p>Painel compartilhado — visível à equipe autenticada. Dados salvos automaticamente.</p></footer>';

  document.getElementById('logoutBtn').addEventListener('click', () => signOut());

  const csvInput = document.getElementById('csvFileInput');
  if (csvInput) csvInput.addEventListener('change', onCsvFileChosen);

  // Precisa vir depois do innerHTML: o módulo desenha dentro do container e
  // registra os próprios cliques. Como render() recria o innerHTML inteiro, a
  // fila é remontada a cada render — por isso a chamada fica aqui, e não no boot.
  resolveView(STATE.view).mount?.();

  if (!appClickBound) {
    app.addEventListener('click', onAppClick);
    appClickBound = true;
  }
  if (!appChangeBound) {
    app.addEventListener('change', onAppChange);
    appChangeBound = true;
  }
}

// Selects nativos disparam um click para abrir a lista. Processar a troca
// nesse click recriava todo o painel com o valor antigo e fechava o combo
// antes que a pessoa pudesse escolher. A alteração só é salva no `change`,
// depois que uma opção foi efetivamente selecionada.
function onAppChange(e) {
  const roleSelect = e.target.closest('select[data-action="team-change-role"]');
  if (roleSelect && isAdmin()) {
    doChangeRole(roleSelect.getAttribute('data-id'), roleSelect.value, render);
    return;
  }
  const workspaceSelect = e.target.closest('select[data-action="team-change-workspace"]');
  if (workspaceSelect && isSuperUser()) {
    doChangeUserWorkspace(workspaceSelect.getAttribute('data-id'), workspaceSelect.value, render);
  }
}

async function onCsvFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const rawRows = await parseCsvFile(file);
    if (!rawRows.length) {
      showToast('O arquivo está vazio ou não pôde ser lido. Confira se as colunas seguem o modelo.', 'error');
      return;
    }
    STATE.importPreview = { fileName: file.name, rows: validateImportRows(rawRows) };
    render();
  } catch (err) {
    console.error(err);
    showToast('Não foi possível ler o arquivo. Confira se é um CSV ou Excel válido e se as colunas seguem o modelo.', 'error');
  }
}

function onAppClick(e) {
  const app = document.getElementById('app');
  if (!e.target.closest('.dd')) {
    app.querySelectorAll('.dd-panel').forEach((p) => p.classList.add('hidden'));
    app.querySelectorAll('[data-action="dd-toggle"]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
  }

  const banner = e.target.closest('[data-action="retry-load"]');
  if (banner) {
    loadAll().then(render).catch(() => render());
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');

  // O papel da equipe é tratado por onAppChange. Não renderize durante o
  // click que apenas abre o select nativo.
  if (action === 'team-change-role' && btn.matches('select')) return;
  if (action === 'team-change-workspace' && btn.matches('select')) return;

  if (action === 'executive-view') {
    selecionarVisaoExecutiva(btn.getAttribute('data-view'));
    render();
    return;
  }

  if (action === 'dd-toggle') {
    const key = btn.getAttribute('data-dd');
    const panel = app.querySelector(`[data-dd-panel="${key}"]`);
    const wasHidden = panel && panel.classList.contains('hidden');
    app.querySelectorAll('[data-action="dd-toggle"]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
    app.querySelectorAll('.dd-panel').forEach((p) => p.classList.add('hidden'));
    if (panel && wasHidden) {
      panel.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  if (action === 'dd-select') {
    const dkey = btn.getAttribute('data-dd');
    const val = btn.getAttribute('data-value');
    if (dkey === 'empresa') STATE.filters.empresa = val;
    if (dkey === 'category') STATE.filters.category = val;
    if (dkey === 'responsible') STATE.filters.responsible = val;
    if (dkey === 'status') STATE.filters.status = val;
    if (dkey === 'receipt') STATE.filters.receipt = val;
    render();
    return;
  }

  if (action === 'clear-filters') {
    STATE.filters = {
      empresa: 'all', category: 'all', responsible: 'all', status: 'all', receipt: 'all',
    };
    render();
    return;
  }

  if (action === 'tab') { STATE.view = btn.getAttribute('data-tab'); render(); return; }
  if (action === 'workspace-create') {
    if (!isSuperUser()) return;
    const name = document.getElementById('workspaceName')?.value || '';
    const documentValue = document.getElementById('workspaceDocument')?.value || '';
    const accessStatus = document.getElementById('workspaceAccess')?.value || 'trial';
    doCreateWorkspace({ name, document: documentValue, accessStatus }, render);
    return;
  }
  if (action === 'workspace-access') {
    if (!isSuperUser()) return;
    doUpdateWorkspaceAccess(id, btn.getAttribute('data-status'), render);
    return;
  }
  if (action === 'new') { openModal(null, { onSaved: render }); return; }
  if (action === 'edit') { if (isManager()) openModal(id, { onSaved: render }); return; }
  if (action === 'done') { doMarkDone(id, render); return; }
  if (action === 'undo') { doUndoLast(id, render); return; }
  if (action === 'delete') { if (isManager()) doDeleteObligation(id, render); return; }
  if (action === 'close') { closeModal(); return; }

  if (action === 'manage-tab') {
    if (!isManager()) return;
    STATE.manageSection = btn.getAttribute('data-section');
    STATE.editingCompanyId = null;
    render();
    if (STATE.manageSection === 'audit' && STATE.auditLog === null) {
      doLoadAuditLog(render);
    }
    return;
  }

  if (action === 'company-add') {
    if (!isAdmin()) return;
    const input = document.getElementById('newCompanyName');
    doCreateCompany(input?.value || '', render);
    return;
  }
  if (action === 'company-edit') {
    if (!isAdmin()) return;
    STATE.editingCompanyId = id;
    render();
    return;
  }
  if (action === 'company-cancel-edit') {
    STATE.editingCompanyId = null;
    render();
    return;
  }
  if (action === 'company-save-edit') {
    if (!isAdmin()) return;
    const input = document.getElementById(`editCompanyName-${id}`);
    STATE.editingCompanyId = null;
    doRenameCompany(id, input?.value || '', render);
    return;
  }
  if (action === 'company-delete') {
    if (!isAdmin()) return;
    doDeleteCompany(id, render);
    return;
  }

  if (action === 'team-toggle-role') {
    if (!isAdmin()) return;
    const nextRole = btn.getAttribute('data-next-role');
    doChangeRole(id, nextRole, render);
    return;
  }
  if (action === 'team-toggle-active') {
    if (!isAdmin()) return;
    const nextActive = btn.getAttribute('data-next-active') === 'true';
    doSetUserActive(id, nextActive, render);
    return;
  }
  if (action === 'team-send-reset') {
    if (!isAdmin()) return;
    doSendPasswordReset(id, render);
    return;
  }

  if (action === 'csv-download-template') {
    downloadCsvTemplate();
    return;
  }
  if (action === 'csv-cancel-import') {
    STATE.importPreview = null;
    render();
    return;
  }
  if (action === 'csv-confirm-import') {
    if (!isAdmin() || !STATE.importPreview) return;
    const validRows = STATE.importPreview.rows.filter((r) => r.valid);
    doImportObligations(validRows, render);
    return;
  }

  if (action === 'holiday-add') {
    if (!isAdmin()) return;
    const date = document.getElementById('newHolidayDate')?.value;
    const name = document.getElementById('newHolidayName')?.value || '';
    doAddHoliday(date, name, render);
    return;
  }
  if (action === 'holiday-delete') {
    if (!isAdmin()) return;
    doDeleteHoliday(id, render);
    return;
  }
  if (action === 'holidays-import-national') {
    if (!isAdmin()) return;
    const year = btn.getAttribute('data-year');
    doImportNationalHolidays(year, render);
    return;
  }

  if (action === 'rule-new') { if (isAdmin()) openRuleModal(null, { onSaved: render }); return; }
  if (action === 'rule-edit') { if (isAdmin()) openRuleModal(id, { onSaved: render }); return; }
  if (action === 'rule-delete') { if (isAdmin()) doDeleteRule(id, render); return; }
  if (action === 'rule-apply') { if (isAdmin()) doApplyRuleToCompanies(id, render); return; }
  if (action === 'occurrence-adjust') { if (isAdmin()) doAdjustOccurrenceDate(id, render); return; }

  if (action === 'user-generate-password') {
    const input = document.getElementById('newUserPassword');
    if (input) input.value = generateTempPassword();
    return;
  }
  if (action === 'user-create') {
    if (!isAdmin()) return;
    const formData = {
      displayName: document.getElementById('newUserName')?.value || '',
      email: document.getElementById('newUserEmail')?.value || '',
      password: document.getElementById('newUserPassword')?.value || '',
      role: document.getElementById('newUserRole')?.value || 'membro',
      workspaceId: document.getElementById('newUserWorkspace')?.value || null,
    };
    doCreateUser(formData, render);
    return;
  }
  if (action === 'copy-new-user-password') {
    const cred = STATE.pendingNewUserCredentials;
    if (cred?.password) {
      navigator.clipboard?.writeText(cred.password)
        .then(() => showToast('Senha copiada.', 'success'))
        .catch(() => showToast('Não foi possível copiar automaticamente — selecione o texto manualmente.', 'error'));
    }
    return;
  }
  if (action === 'dismiss-new-user-credentials') {
    STATE.pendingNewUserCredentials = null;
    render();
    return;
  }

  if (action === 'regime-new') { if (isAdmin()) doOpenRegimeDialog(null, render); return; }
  if (action === 'regime-edit') { if (isAdmin()) doOpenRegimeDialog(id, render); return; }
  if (action === 'regime-delete') { if (isAdmin()) doDeleteTaxRegime(id, render); return; }
  if (action === 'regime-link-rules') { if (isAdmin()) doOpenRegimeRulesDialog(id, render); return; }
  if (action === 'regime-link-companies') { if (isAdmin()) doOpenRegimeCompaniesDialog(id, render); return; }
  if (action === 'company-apply-regime') { if (isAdmin()) doApplyRegimeToCompany(id, render); return; }

  if (action === 'checklist-toggle') {
    const done = btn.getAttribute('data-done') === 'true';
    doToggleChecklistItem(id, done, render);
    return;
  }

  if (action === 'view-attachment') {
    const path = btn.getAttribute('data-path');
    getAttachmentUrl(path)
      .then((url) => window.open(url, '_blank'))
      .catch((err) => {
        console.error(err);
        showToast('Não foi possível abrir o comprovante agora.', 'error');
      });
    return;
  }
}
