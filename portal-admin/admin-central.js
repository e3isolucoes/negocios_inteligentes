const SAFE_DEFAULTS = Object.freeze({
  intelligence: Object.freeze({ enabled: false, ingestionEnabled: false, agentMode: 'DISABLED', requireHumanApproval: true, allowSensitivePersonalData: false, defaultRetentionClass: 'ANALYTICS_2Y', mappingPurposeId: 'process-mapping-v1' }),
  governance: Object.freeze({ auditLevel: 'ENHANCED', savingValidationRequired: true }),
});

const state = {
  organizationId: '', tools: [], filter: '', busyToolId: '',
  users: [], userFilter: '', userStatus: 'ALL', userBusy: false, canDelegateAdmin: false,
  settings: structuredClone(SAFE_DEFAULTS), settingsVersion: 0, settingsUpdatedAt: '', audit: [], settingsBusy: false,
};

const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
const els = {
  organizationId: q('#organizationId'), settingsVersion: q('#settingsVersion'), metricUsers: q('#metricUsers'), metricTotal: q('#metricTotal'), metricGranted: q('#metricGranted'), metricIntelligence: q('#metricIntelligence'), metricIntelligenceHint: q('#metricIntelligenceHint'), metricUpdated: q('#metricUpdated'), globalStatus: q('#globalStatus'),
  toolsGrid: q('#toolsGrid'), searchInput: q('#searchInput'), tabs: qa('[data-tab]'), panels: qa('[data-panel]'),
  usersTableBody: q('#usersTableBody'), usersTableWrap: q('#usersTableWrap'), userSearchInput: q('#userSearchInput'), userStatusFilter: q('#userStatusFilter'), createUserButton: q('#createUserButton'), userDialog: q('#userDialog'), userForm: q('#userForm'), userDialogEyebrow: q('#userDialogEyebrow'), userDialogTitle: q('#userDialogTitle'), userId: q('#userId'), userName: q('#userName'), userEmail: q('#userEmail'), userRole: q('#userRole'), userSaveButton: q('#userSaveButton'),
  settingsForm: q('#settingsForm'), saveSettings: q('#saveSettings'), reloadSettings: q('#reloadSettings'), intelligenceEnabled: q('#intelligenceEnabled'), ingestionEnabled: q('#ingestionEnabled'), agentMode: q('#agentMode'), requireHumanApproval: q('#requireHumanApproval'), allowSensitivePersonalData: q('#allowSensitivePersonalData'), defaultRetentionClass: q('#defaultRetentionClass'), mappingPurposeId: q('#mappingPurposeId'), auditLevel: q('#auditLevel'), savingValidationRequired: q('#savingValidationRequired'), auditCount: q('#auditCount'), auditList: q('#auditList'),
  confirmDialog: q('#confirmDialog'), confirmTitle: q('#confirmTitle'), confirmMessage: q('#confirmMessage'),
};

function setStatus(message = '', tone = '') { els.globalStatus.textContent = message; els.globalStatus.className = `status-message${tone ? ` ${tone}` : ''}`; }
function formatDate(value) { if (!value) return 'Nunca'; const d = new Date(value); if (Number.isNaN(d.getTime())) return 'Indisponível'; return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d); }
function toolLabel(tool) { return tool.name || tool.title || tool.label || tool.id || 'Ferramenta'; }
function toolDescription(tool) { return tool.description || tool.summary || 'Ferramenta disponível no catálogo do Portal E3I.'; }
function organizationPath(suffix) { if (!state.organizationId) throw new Error('Organização ativa não identificada'); return `/api/admin/organizations/${encodeURIComponent(state.organizationId)}${suffix}`; }
function settingsEndpoint() { return organizationPath('/central-settings'); }
function usersEndpoint() { return organizationPath('/users'); }
function userEndpoint(userId, action = '') { return organizationPath(`/users/${encodeURIComponent(userId)}${action ? `/${action}` : ''}`); }

async function readPayload(response) { const type = response.headers.get('content-type') || ''; return type.includes('application/json') ? response.json().catch(() => ({})) : {}; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await readPayload(response);
  if (!response.ok) { const error = new Error(payload.error || payload.message || `HTTP ${response.status}`); error.status = response.status; error.code = payload.code || ''; error.payload = payload; throw error; }
  return payload;
}
function adminWrite(path, { method = 'POST', body } = {}) { return api(path, { method, headers: { 'content-type': 'application/json', 'x-e3i-admin-request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) }); }

function updateMetrics() {
  els.metricUsers.textContent = String(state.users.filter((u) => u.status === 'ACTIVE').length);
  els.metricTotal.textContent = String(state.tools.length);
  els.metricGranted.textContent = String(state.tools.filter((t) => Boolean(t.granted)).length);
  els.metricIntelligence.textContent = state.settings.intelligence.enabled ? 'Ativo' : 'Desligado';
  els.metricIntelligenceHint.textContent = state.settings.intelligence.ingestionEnabled ? 'ingestão habilitada' : 'ingestão desligada';
  els.metricUpdated.textContent = state.settingsUpdatedAt ? formatDate(state.settingsUpdatedAt) : 'Nunca';
  els.settingsVersion.textContent = `Configuração v${state.settingsVersion}`;
}

function badge(text, tone = 'neutral') { const el = document.createElement('span'); el.className = `badge ${tone}`; el.textContent = text; return el; }
function makeAccessButton(tool) { const button = document.createElement('button'); button.type = 'button'; button.className = `btn ${tool.granted ? 'btn-revoke' : 'btn-primary'}`; button.textContent = state.busyToolId === tool.id ? 'Salvando…' : (tool.granted ? 'Revogar acesso' : 'Liberar acesso'); button.disabled = Boolean(state.busyToolId); button.addEventListener('click', () => handleAccessChange(tool)); return button; }
function renderTools() {
  updateMetrics(); els.toolsGrid.replaceChildren(); els.toolsGrid.setAttribute('aria-busy', state.busyToolId ? 'true' : 'false');
  const query = state.filter.trim().toLocaleLowerCase('pt-BR');
  const visible = state.tools.filter((tool) => !query || [toolLabel(tool), tool.id, toolDescription(tool)].filter(Boolean).some((v) => String(v).toLocaleLowerCase('pt-BR').includes(query)));
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = state.tools.length ? 'Nenhuma ferramenta corresponde à busca.' : 'Nenhuma ferramenta está disponível para este contexto.'; els.toolsGrid.append(empty); return; }
  visible.forEach((tool) => {
    const card = document.createElement('article'); card.className = `tool-card${tool.granted ? ' is-granted' : ''}`;
    const content = document.createElement('div'); const head = document.createElement('div'); head.className = 'tool-head'; const identity = document.createElement('div'); const title = document.createElement('h3'); title.className = 'tool-name'; title.textContent = toolLabel(tool); const id = document.createElement('code'); id.className = 'tool-id'; id.textContent = tool.id || 'sem-identificador'; identity.append(title, id); head.append(identity, badge(tool.granted ? 'Acesso liberado' : 'Acesso bloqueado', tool.granted ? 'granted' : 'blocked')); const desc = document.createElement('p'); desc.className = 'tool-description'; desc.textContent = toolDescription(tool); content.append(head, desc);
    const footer = document.createElement('div'); footer.className = 'tool-footer'; const copy = document.createElement('span'); copy.textContent = tool.granted ? 'Usuários elegíveis da organização podem abrir a ferramenta.' : 'A ferramenta não está concedida para esta organização.'; footer.append(copy, makeAccessButton(tool)); card.append(content, footer); els.toolsGrid.append(card);
  });
}

function roleLabel(role, isRoot = false) { if (isRoot) return 'Administrador raiz'; return role === 'E3I_ADMIN' ? 'Administrador E3I' : 'Operador'; }
function normalizeUser(user) { return { id: String(user.id || ''), name: String(user.name || ''), email: String(user.email || ''), role: user.role === 'E3I_ADMIN' ? 'E3I_ADMIN' : 'OPERATOR', status: user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', mustChangePassword: user.mustChangePassword === true, createdAt: user.createdAt || '', updatedAt: user.updatedAt || '', isSelf: user.isSelf === true, isRoot: user.isRoot === true }; }
function userActionButton(label, className, handler, disabled = false) { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${className}`; b.textContent = label; b.disabled = disabled || state.userBusy; b.addEventListener('click', handler); return b; }
function renderUsers() {
  updateMetrics(); els.usersTableBody.replaceChildren(); els.usersTableWrap.setAttribute('aria-busy', state.userBusy ? 'true' : 'false');
  const query = state.userFilter.trim().toLocaleLowerCase('pt-BR');
  const visible = state.users.filter((user) => (state.userStatus === 'ALL' || user.status === state.userStatus) && (!query || [user.name, user.email, roleLabel(user.role, user.isRoot)].some((v) => String(v).toLocaleLowerCase('pt-BR').includes(query))));
  if (!visible.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 5; cell.className = 'empty-state'; cell.textContent = state.users.length ? 'Nenhum usuário corresponde aos filtros.' : 'Nenhum usuário encontrado nesta organização.'; row.append(cell); els.usersTableBody.append(row); return; }
  visible.forEach((user) => {
    const row = document.createElement('tr');
    const identity = document.createElement('td'); const name = document.createElement('span'); name.className = 'user-name'; name.textContent = user.name || 'Sem nome'; const email = document.createElement('span'); email.className = 'user-email'; email.textContent = user.email; identity.append(name, email);
    const role = document.createElement('td'); const roleCode = document.createElement('span'); roleCode.className = 'user-role'; roleCode.textContent = roleLabel(user.role, user.isRoot); role.append(roleCode);
    const status = document.createElement('td'); status.append(badge(user.status === 'ACTIVE' ? 'Ativo' : 'Suspenso', user.status === 'ACTIVE' ? 'active' : 'suspended'));
    const onboarding = document.createElement('td'); onboarding.append(badge(user.mustChangePassword ? 'Pendente' : 'Concluído', user.mustChangePassword ? 'pending' : 'neutral'));
    const actions = document.createElement('td'); actions.className = 'actions-col'; const bar = document.createElement('div'); bar.className = 'user-actions';
    const protectedAdmin = user.role === 'E3I_ADMIN' && !state.canDelegateAdmin;
    bar.append(userActionButton('Editar', 'btn-ghost', () => openUserDialog(user), protectedAdmin));
    bar.append(userActionButton('Encerrar sessões', 'btn-ghost', () => userCommand(user, 'revoke-sessions', 'Encerrar sessões?', `Todas as sessões ativas de ${user.name || user.email} serão revogadas.`, false), protectedAdmin));
    bar.append(userActionButton('Forçar 1º acesso', 'btn-ghost', () => userCommand(user, 'force-first-login', 'Forçar novo primeiro acesso?', `O usuário ${user.name || user.email} precisará validar o e-mail e definir uma nova senha. As sessões atuais serão encerradas.`, true), protectedAdmin));
    if (user.status === 'ACTIVE') bar.append(userActionButton('Suspender', 'btn-revoke', () => userCommand(user, 'suspend', 'Suspender usuário?', `O acesso de ${user.name || user.email} será bloqueado e suas sessões serão revogadas. O histórico será preservado.`, true), user.isSelf || protectedAdmin || user.isRoot));
    else bar.append(userActionButton('Reativar', 'btn-primary', () => userCommand(user, 'reactivate', 'Reativar usuário?', `O usuário ${user.name || user.email} voltará a poder acessar o Portal conforme suas permissões.`, false), protectedAdmin || user.isRoot));
    actions.append(bar); row.append(identity, role, status, onboarding, actions); els.usersTableBody.append(row);
  });
}

function validateUserForm() {
  const name = els.userName.value.trim(); const email = els.userEmail.value.trim().toLowerCase(); const role = els.userRole.value;
  if (!name || name.length > 120) throw new Error('Informe um nome válido com até 120 caracteres.');
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (!['OPERATOR', 'E3I_ADMIN'].includes(role)) throw new Error('Papel inválido.');
  return { name, email, role };
}
function openUserDialog(user = null) {
  els.userId.value = user?.id || ''; els.userName.value = user?.name || ''; els.userEmail.value = user?.email || ''; els.userRole.value = user?.role || 'OPERATOR'; els.userRole.disabled = !state.canDelegateAdmin;
  els.userDialogEyebrow.textContent = user ? 'ALTERAR USUÁRIO' : 'NOVO USUÁRIO'; els.userDialogTitle.textContent = user ? 'Editar usuário' : 'Criar usuário'; els.userSaveButton.textContent = user ? 'Salvar alterações' : 'Criar usuário';
  els.userDialog.showModal(); setTimeout(() => els.userName.focus(), 0);
}
async function saveUser() {
  if (state.userBusy) return; const input = validateUserForm(); const userId = els.userId.value.trim(); state.userBusy = true; els.userSaveButton.disabled = true; setStatus(userId ? 'Salvando alterações do usuário…' : 'Criando usuário…');
  try {
    if (userId) await adminWrite(userEndpoint(userId), { method: 'PUT', body: input }); else await adminWrite(usersEndpoint(), { method: 'POST', body: input });
    els.userDialog.close(); await loadUsers(); setStatus(userId ? 'Usuário atualizado com sucesso.' : 'Usuário criado. O primeiro acesso deverá ser ativado pelo e-mail cadastrado.', 'success');
  } catch (error) { handleAdminError(error, 'Não foi possível salvar o usuário'); }
  finally { state.userBusy = false; els.userSaveButton.disabled = false; renderUsers(); }
}
async function userCommand(user, action, title, message, danger) {
  if (state.userBusy) return; const confirmed = await confirmAction({ title, message, danger }); if (!confirmed) return; state.userBusy = true; renderUsers(); setStatus('Executando ação administrativa…');
  try { await adminWrite(userEndpoint(user.id, action)); await loadUsers(); const labels = { suspend: 'Usuário suspenso e sessões revogadas.', reactivate: 'Usuário reativado.', 'revoke-sessions': 'Sessões do usuário revogadas.', 'force-first-login': 'Novo primeiro acesso exigido e sessões revogadas.' }; setStatus(labels[action] || 'Ação concluída.', 'success'); }
  catch (error) { handleAdminError(error, 'Não foi possível concluir a ação'); }
  finally { state.userBusy = false; renderUsers(); }
}
function handleAdminError(error, prefix) {
  if (error.status === 401) setStatus('Sua sessão expirou. Entre novamente no Portal E3I.', 'error');
  else if (error.status === 403) setStatus(error.message || 'Ação não permitida para esta sessão.', 'error');
  else if (error.status === 404) setStatus('Recurso não encontrado no contexto da organização ativa.', 'error');
  else if (error.status === 409) setStatus(error.message || 'Conflito de atualização. Recarregue os dados.', 'warning');
  else setStatus(`${prefix}: ${error.message}`, 'error');
}

function normalizeSettings(payload) {
  const c = payload && typeof payload === 'object' ? payload : {}; const i = c.intelligence && typeof c.intelligence === 'object' ? c.intelligence : {}; const g = c.governance && typeof c.governance === 'object' ? c.governance : {};
  return { intelligence: { enabled: i.enabled === true, ingestionEnabled: i.ingestionEnabled === true, agentMode: i.agentMode === 'READ_ONLY' ? 'READ_ONLY' : 'DISABLED', requireHumanApproval: i.requireHumanApproval !== false, allowSensitivePersonalData: i.allowSensitivePersonalData === true, defaultRetentionClass: String(i.defaultRetentionClass || SAFE_DEFAULTS.intelligence.defaultRetentionClass), mappingPurposeId: String(i.mappingPurposeId || SAFE_DEFAULTS.intelligence.mappingPurposeId) }, governance: { auditLevel: g.auditLevel === 'STANDARD' ? 'STANDARD' : 'ENHANCED', savingValidationRequired: g.savingValidationRequired !== false } };
}
function renderSettings() { const { intelligence: i, governance: g } = state.settings; els.intelligenceEnabled.checked = i.enabled; els.ingestionEnabled.checked = i.ingestionEnabled; els.agentMode.value = i.agentMode; els.requireHumanApproval.checked = i.requireHumanApproval; els.allowSensitivePersonalData.checked = i.allowSensitivePersonalData; els.defaultRetentionClass.value = i.defaultRetentionClass; els.mappingPurposeId.value = i.mappingPurposeId; els.auditLevel.value = g.auditLevel; els.savingValidationRequired.checked = g.savingValidationRequired; els.saveSettings.disabled = state.settingsBusy; els.reloadSettings.disabled = state.settingsBusy; updateMetrics(); }
function collectSettings() { const purpose = els.mappingPurposeId.value.trim(); if (!purpose || purpose.length > 120) throw new Error('Informe uma finalidade técnica válida com até 120 caracteres.'); if (/[@]|\d{3}\.\d{3}\.\d{3}/.test(purpose)) throw new Error('Use identificador técnico, sem e-mail ou CPF.'); return { intelligence: { enabled: els.intelligenceEnabled.checked, ingestionEnabled: els.ingestionEnabled.checked, agentMode: els.agentMode.value, requireHumanApproval: els.requireHumanApproval.checked, allowSensitivePersonalData: els.allowSensitivePersonalData.checked, defaultRetentionClass: els.defaultRetentionClass.value, mappingPurposeId: purpose }, governance: { auditLevel: els.auditLevel.value, savingValidationRequired: els.savingValidationRequired.checked } }; }
function renderAudit() {
  els.auditList.replaceChildren(); const records = Array.isArray(state.audit) ? state.audit : []; els.auditCount.textContent = `${records.length} ${records.length === 1 ? 'registro' : 'registros'}`;
  if (!records.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'Ainda não há alterações de parametrização registradas.'; els.auditList.append(empty); return; }
  records.slice().reverse().forEach((record) => { const item = document.createElement('article'); item.className = 'audit-item'; const text = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `Configuração atualizada para v${record.version ?? '—'}`; const detail = document.createElement('small'); detail.textContent = `${Array.isArray(record.changedKeys) ? record.changedKeys.join(', ') : 'parâmetros governados'} · ator ${record.actorId || 'não identificado'}`; text.append(title, detail); const time = document.createElement('time'); time.dateTime = record.occurredAt || ''; time.textContent = formatDate(record.occurredAt); item.append(text, time); els.auditList.append(item); });
}
function switchTab(name) { els.tabs.forEach((tab) => { const active = tab.dataset.tab === name; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); }); els.panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; }); }
function confirmAction({ title, message, danger = false }) { if (!els.confirmDialog?.showModal) return Promise.resolve(window.confirm(message)); els.confirmTitle.textContent = title; els.confirmMessage.textContent = message; const button = els.confirmDialog.querySelector('button[value="confirm"]'); button.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`; els.confirmDialog.showModal(); return new Promise((resolve) => els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue === 'confirm'), { once: true })); }

async function handleAccessChange(tool) {
  if (!state.organizationId || !tool.id || state.busyToolId) return;
  if (tool.granted && !(await confirmAction({ title: 'Revogar acesso?', message: `A organização ativa deixará de ter acesso a “${toolLabel(tool)}”.`, danger: true }))) return;
  state.busyToolId = tool.id; setStatus(tool.granted ? 'Revogando acesso…' : 'Liberando acesso…'); renderTools();
  try { await api(organizationPath(`/client-tools/${encodeURIComponent(tool.id)}`), { method: tool.granted ? 'DELETE' : 'PUT' }); tool.granted = !tool.granted; setStatus(tool.granted ? `Acesso a “${toolLabel(tool)}” liberado.` : `Acesso a “${toolLabel(tool)}” revogado.`, 'success'); }
  catch (error) { handleAdminError(error, 'Não foi possível alterar o acesso'); }
  finally { state.busyToolId = ''; renderTools(); }
}
async function loadTools() { els.toolsGrid.setAttribute('aria-busy', 'true'); const payload = await api('/api/client-tools'); state.organizationId = payload.organizationId || ''; state.tools = Array.isArray(payload.tools) ? payload.tools : []; els.organizationId.textContent = state.organizationId || 'Não identificada'; renderTools(); els.toolsGrid.setAttribute('aria-busy', 'false'); if (!state.organizationId) throw new Error('O Portal não informou a organização ativa.'); }
async function loadUsers() { if (!state.organizationId) return; els.usersTableWrap.setAttribute('aria-busy', 'true'); const payload = await api(usersEndpoint()); state.canDelegateAdmin = payload?.permissions?.canDelegateAdmin === true; state.users = Array.isArray(payload.users) ? payload.users.map(normalizeUser) : []; renderUsers(); els.usersTableWrap.setAttribute('aria-busy', 'false'); }
async function loadSettings({ announce = false } = {}) {
  if (!state.organizationId) return; state.settingsBusy = true; renderSettings(); if (announce) setStatus('Recarregando parâmetros…');
  try { const payload = await api(settingsEndpoint()); state.settings = normalizeSettings(payload.settings); state.settingsVersion = Number.isInteger(payload.version) ? payload.version : 0; state.settingsUpdatedAt = payload.updatedAt || ''; state.audit = Array.isArray(payload.audit) ? payload.audit : []; renderSettings(); renderAudit(); if (announce) setStatus('Parâmetros recarregados.', 'success'); }
  catch (error) { handleAdminError(error, 'Não foi possível carregar os parâmetros'); }
  finally { state.settingsBusy = false; renderSettings(); }
}
async function saveSettings() {
  if (state.settingsBusy) return; let next; try { next = collectSettings(); } catch (error) { setStatus(error.message, 'error'); return; }
  if (next.intelligence.allowSensitivePersonalData && !state.settings.intelligence.allowSensitivePersonalData) { const ok = await confirmAction({ title: 'Permitir dados pessoais sensíveis?', message: 'Ative somente com finalidade, base legal e governança aprovadas. A alteração será auditada.', danger: true }); if (!ok) return; }
  state.settingsBusy = true; renderSettings(); setStatus('Salvando parâmetros…');
  try { const payload = await adminWrite(settingsEndpoint(), { method: 'PUT', body: { expectedVersion: state.settingsVersion, settings: next } }); state.settings = normalizeSettings(payload.settings); state.settingsVersion = Number(payload.version || 0); state.settingsUpdatedAt = payload.updatedAt || ''; state.audit = Array.isArray(payload.audit) ? payload.audit : []; renderAudit(); setStatus('Parâmetros salvos com sucesso.', 'success'); }
  catch (error) { if (error.status === 409) { setStatus('Outra sessão alterou a configuração. Os dados serão recarregados.', 'warning'); await loadSettings(); } else handleAdminError(error, 'Não foi possível salvar os parâmetros'); }
  finally { state.settingsBusy = false; renderSettings(); }
}

els.tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
els.searchInput.addEventListener('input', (e) => { state.filter = e.target.value; renderTools(); });
els.userSearchInput.addEventListener('input', (e) => { state.userFilter = e.target.value; renderUsers(); });
els.userStatusFilter.addEventListener('change', (e) => { state.userStatus = e.target.value; renderUsers(); });
els.createUserButton.addEventListener('click', () => openUserDialog());
els.userForm.addEventListener('submit', (e) => { e.preventDefault(); saveUser(); });
q('[data-user-cancel]').addEventListener('click', () => els.userDialog.close());
els.reloadSettings.addEventListener('click', () => loadSettings({ announce: true }));
els.saveSettings.addEventListener('click', saveSettings);

(async function boot() {
  setStatus('Validando sessão administrativa e carregando dados…');
  try { await loadTools(); await Promise.all([loadUsers(), loadSettings()]); setStatus('Administração central carregada.', 'success'); }
  catch (error) { handleAdminError(error, 'Não foi possível carregar a administração central'); }
})();
