const SAFE_DEFAULTS = Object.freeze({
  intelligence: Object.freeze({ enabled: false, ingestionEnabled: false, agentMode: 'DISABLED', requireHumanApproval: true, allowSensitivePersonalData: false, defaultRetentionClass: 'ANALYTICS_2Y', mappingPurposeId: 'process-mapping-v1' }),
  governance: Object.freeze({ auditLevel: 'ENHANCED', savingValidationRequired: true }),
});

const state = {
  organizationId: '', activeOrganizationId: '', organizations: [], organizationPermissions: {}, companyFilter: '', companyBusy: false,
  tools: [], filter: '', busyToolId: '',
  users: [], userFilter: '', userStatus: 'ALL', userBusy: false, canDelegateAdmin: false, canManageMemberships: false, organizationName: '',
  settings: structuredClone(SAFE_DEFAULTS), settingsVersion: 0, settingsUpdatedAt: '', audit: [], settingsBusy: false,
};

const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
const els = {
  organizationId: q('#organizationId'), organizationSelect: q('#organizationSelect'), activeOrganizationHint: q('#activeOrganizationHint'), activateOrganizationButton: q('#activateOrganizationButton'), organizationContextText: q('#organizationContextText'), settingsVersion: q('#settingsVersion'), metricUsers: q('#metricUsers'), metricTotal: q('#metricTotal'), metricGranted: q('#metricGranted'), metricIntelligence: q('#metricIntelligence'), metricIntelligenceHint: q('#metricIntelligenceHint'), metricUpdated: q('#metricUpdated'), globalStatus: q('#globalStatus'),
  companiesTableBody: q('#companiesTableBody'), companiesTableWrap: q('#companiesTableWrap'), companySearchInput: q('#companySearchInput'), createOrganizationButton: q('#createOrganizationButton'), organizationDialog: q('#organizationDialog'), organizationForm: q('#organizationForm'), organizationDialogEyebrow: q('#organizationDialogEyebrow'), organizationDialogTitle: q('#organizationDialogTitle'), organizationFormId: q('#organizationFormId'), organizationLegalName: q('#organizationLegalName'), organizationTradeName: q('#organizationTradeName'), organizationDocument: q('#organizationDocument'), organizationStatus: q('#organizationStatus'), organizationSaveButton: q('#organizationSaveButton'),
  toolsGrid: q('#toolsGrid'), searchInput: q('#searchInput'), tabs: qa('[data-tab]'), panels: qa('[data-panel]'),
  usersTableBody: q('#usersTableBody'), usersTableWrap: q('#usersTableWrap'), userSearchInput: q('#userSearchInput'), userStatusFilter: q('#userStatusFilter'), createUserButton: q('#createUserButton'), userDialog: q('#userDialog'), userForm: q('#userForm'), userDialogEyebrow: q('#userDialogEyebrow'), userDialogTitle: q('#userDialogTitle'), userId: q('#userId'), userName: q('#userName'), userEmail: q('#userEmail'), userRole: q('#userRole'), userOrganization: q('#userOrganization'), userSaveButton: q('#userSaveButton'),
  settingsForm: q('#settingsForm'), saveSettings: q('#saveSettings'), reloadSettings: q('#reloadSettings'), intelligenceEnabled: q('#intelligenceEnabled'), ingestionEnabled: q('#ingestionEnabled'), agentMode: q('#agentMode'), requireHumanApproval: q('#requireHumanApproval'), allowSensitivePersonalData: q('#allowSensitivePersonalData'), defaultRetentionClass: q('#defaultRetentionClass'), mappingPurposeId: q('#mappingPurposeId'), auditLevel: q('#auditLevel'), savingValidationRequired: q('#savingValidationRequired'), auditCount: q('#auditCount'), auditList: q('#auditList'),
  confirmDialog: q('#confirmDialog'), confirmTitle: q('#confirmTitle'), confirmMessage: q('#confirmMessage'),
};

function setStatus(message = '', tone = '') { els.globalStatus.textContent = message; els.globalStatus.className = `status-message${tone ? ` ${tone}` : ''}`; }
function formatDate(value) { if (!value) return 'Nunca'; const d = new Date(value); if (Number.isNaN(d.getTime())) return 'Indisponível'; return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d); }
function toolLabel(tool) { return tool.name || tool.title || tool.label || tool.id || 'Ferramenta'; }
function toolDescription(tool) { return tool.description || tool.summary || 'Ferramenta disponível no catálogo do Portal E3I.'; }
function organizationPath(suffix) { if (!state.organizationId) throw new Error('Empresa em gestão não identificada'); return `/api/admin/organizations/${encodeURIComponent(state.organizationId)}${suffix}`; }
function settingsEndpoint() { return organizationPath('/central-settings'); }
function usersEndpoint() { return organizationPath('/users'); }
function userEndpoint(userId, action = '') { return organizationPath(`/users/${encodeURIComponent(userId)}${action ? `/${action}` : ''}`); }

async function readPayload(response) { const type = response.headers.get('content-type') || ''; return type.includes('application/json') ? response.json().catch(() => ({})) : {}; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json', ...(options.headers || {}) }, ...options });
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
  if (state.organizationId && state.activeOrganizationId && state.organizationId !== state.activeOrganizationId) {
    const warning = document.createElement('div');
    warning.className = 'empty-state access-context-warning';
    warning.textContent = 'A empresa em gestão não é a empresa ativa da sessão. Torne esta empresa ativa para visualizar, conceder ou revogar ferramentas com segurança.';
    els.toolsGrid.append(warning);
    return;
  }
  const query = state.filter.trim().toLocaleLowerCase('pt-BR');
  const visible = state.tools.filter((tool) => !query || [toolLabel(tool), tool.id, toolDescription(tool)].filter(Boolean).some((v) => String(v).toLocaleLowerCase('pt-BR').includes(query)));
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = state.tools.length ? 'Nenhuma ferramenta corresponde à busca.' : 'Nenhuma ferramenta está disponível para este contexto.'; els.toolsGrid.append(empty); return; }
  visible.forEach((tool) => {
    const card = document.createElement('article'); card.className = `tool-card${tool.granted ? ' is-granted' : ''}`;
    const content = document.createElement('div'); const head = document.createElement('div'); head.className = 'tool-head'; const identity = document.createElement('div'); const title = document.createElement('h3'); title.className = 'tool-name'; title.textContent = toolLabel(tool); const id = document.createElement('code'); id.className = 'tool-id'; id.textContent = tool.id || 'sem-identificador'; identity.append(title, id); head.append(identity, badge(tool.granted ? 'Acesso liberado' : 'Acesso bloqueado', tool.granted ? 'granted' : 'blocked')); const desc = document.createElement('p'); desc.className = 'tool-description'; desc.textContent = toolDescription(tool); content.append(head, desc);
    const footer = document.createElement('div'); footer.className = 'tool-footer'; const copy = document.createElement('span'); copy.textContent = tool.granted ? 'Usuários elegíveis da organização podem abrir a ferramenta.' : 'A ferramenta não está concedida para esta organização.'; footer.append(copy, makeAccessButton(tool)); card.append(content, footer); els.toolsGrid.append(card);
  });
}


function organizationLabel(organization) {
  return organization?.tradeName || organization?.legalName || organization?.id || 'Empresa';
}
function currentOrganization() {
  return state.organizations.find((item) => item.id === state.organizationId) || null;
}
function renderOrganizationContext() {
  const selected = currentOrganization();
  const active = state.organizations.find((item) => item.id === state.activeOrganizationId) || null;
  const selectedLabel = selected ? organizationLabel(selected) : 'Nenhuma empresa selecionada';
  const activeLabel = active ? organizationLabel(active) : (state.activeOrganizationId || 'não identificada');
  els.organizationId.textContent = selected ? `${selectedLabel} · ${selected.id}` : 'Não identificada';
  els.activeOrganizationHint.textContent = `Empresa ativa da sessão: ${activeLabel}`;
  els.organizationContextText.textContent = state.organizationId === state.activeOrganizationId
    ? `Você está administrando a mesma empresa usada pela sessão: ${selectedLabel}.`
    : `Você está administrando ${selectedLabel}, mas a sessão ainda usa ${activeLabel}. Torne a empresa em gestão ativa antes de conceder ferramentas ou testar o acesso.`;
  els.activateOrganizationButton.disabled = !state.organizationId || state.organizationId === state.activeOrganizationId || state.companyBusy;
}
function renderOrganizationSelect() {
  els.organizationSelect.replaceChildren();
  state.organizations.forEach((organization) => {
    const option = document.createElement('option');
    option.value = organization.id;
    option.textContent = `${organizationLabel(organization)} · ${organization.id}`;
    option.selected = organization.id === state.organizationId;
    els.organizationSelect.append(option);
  });
  els.organizationSelect.disabled = state.organizations.length < 2 || state.companyBusy;
  renderOrganizationContext();
}
function companyActionButton(label, className, handler, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${className}`;
  button.textContent = label;
  button.disabled = disabled || state.companyBusy;
  button.addEventListener('click', handler);
  return button;
}
function renderOrganizations() {
  els.companiesTableBody.replaceChildren();
  els.companiesTableWrap.setAttribute('aria-busy', state.companyBusy ? 'true' : 'false');
  const query = state.companyFilter.trim().toLocaleLowerCase('pt-BR');
  const visible = state.organizations.filter((organization) =>
    !query || [organization.tradeName, organization.legalName, organization.document, organization.id]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(query))
  );
  if (!visible.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty-state';
    cell.textContent = 'Nenhuma empresa encontrada.';
    row.append(cell);
    els.companiesTableBody.append(row);
    renderOrganizationSelect();
    return;
  }
  visible.forEach((organization) => {
    const row = document.createElement('tr');
    if (organization.id === state.organizationId) row.classList.add('is-selected-row');

    const company = document.createElement('td');
    const name = document.createElement('span'); name.className = 'user-name'; name.textContent = organizationLabel(organization);
    const legal = document.createElement('span'); legal.className = 'user-email'; legal.textContent = organization.legalName || organization.id;
    company.append(name, legal);

    const documentCell = document.createElement('td'); documentCell.textContent = organization.document || '—';
    const users = document.createElement('td'); users.textContent = String(organization.usersCount || 0);
    const admins = document.createElement('td'); admins.textContent = String(organization.adminCount || 0);
    const status = document.createElement('td'); status.append(badge(organization.status === 'ACTIVE' ? 'Ativa' : 'Suspensa', organization.status === 'ACTIVE' ? 'active' : 'suspended'));

    const actions = document.createElement('td'); actions.className = 'actions-col';
    const bar = document.createElement('div'); bar.className = 'user-actions';
    bar.append(companyActionButton(
      organization.id === state.organizationId ? 'Em gestão' : 'Administrar',
      organization.id === state.organizationId ? 'btn-secondary' : 'btn-primary',
      () => selectOrganization(organization.id),
      organization.id === state.organizationId,
    ));
    if (organization.id !== state.activeOrganizationId) {
      bar.append(companyActionButton('Tornar ativa', 'btn-ghost', () => activateOrganization(organization.id), organization.status !== 'ACTIVE'));
    } else {
      bar.append(badge('Sessão ativa', 'granted'));
    }
    if (state.organizationPermissions.canCreateOrganizations) {
      bar.append(companyActionButton('Editar', 'btn-ghost', () => openOrganizationDialog(organization)));
    }
    actions.append(bar);
    row.append(company, documentCell, users, admins, status, actions);
    els.companiesTableBody.append(row);
  });
  renderOrganizationSelect();
  els.createOrganizationButton.hidden = state.organizationPermissions.canCreateOrganizations !== true;
}
function validateOrganizationForm() {
  const legalName = els.organizationLegalName.value.trim();
  const tradeName = els.organizationTradeName.value.trim();
  const document = els.organizationDocument.value.replace(/\D/g, '');
  const status = els.organizationStatus.value;
  if (!legalName || legalName.length > 180) throw new Error('Informe uma razão social válida.');
  if (!tradeName || tradeName.length > 180) throw new Error('Informe um nome válido para a empresa.');
  if (document && (document.length < 11 || document.length > 14)) throw new Error('Informe um CNPJ/CPF empresarial válido.');
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new Error('Status da empresa inválido.');
  return { legalName, tradeName, document, status };
}
function openOrganizationDialog(organization = null) {
  els.organizationFormId.value = organization?.id || '';
  els.organizationLegalName.value = organization?.legalName || '';
  els.organizationTradeName.value = organization?.tradeName || '';
  els.organizationDocument.value = organization?.document || '';
  els.organizationStatus.value = organization?.status || 'ACTIVE';
  els.organizationStatus.disabled = !organization;
  els.organizationDialogEyebrow.textContent = organization ? 'ALTERAR EMPRESA' : 'NOVA EMPRESA';
  els.organizationDialogTitle.textContent = organization ? 'Editar empresa' : 'Cadastrar empresa';
  els.organizationSaveButton.textContent = organization ? 'Salvar alterações' : 'Cadastrar empresa';
  els.organizationDialog.showModal();
}
async function saveOrganization() {
  if (state.companyBusy) return;
  let input;
  try { input = validateOrganizationForm(); } catch (error) { setStatus(error.message, 'error'); return; }
  const organizationId = els.organizationFormId.value.trim();
  state.companyBusy = true; renderOrganizations(); setStatus(organizationId ? 'Salvando empresa…' : 'Cadastrando empresa…');
  try {
    const payload = await adminWrite(organizationId ? `/api/admin/organizations/${encodeURIComponent(organizationId)}` : '/api/admin/organizations', {
      method: organizationId ? 'PUT' : 'POST',
      body: input,
    });
    els.organizationDialog.close();
    await loadOrganizations(payload?.organization?.id || organizationId || '');
    setStatus(organizationId ? 'Empresa atualizada com sucesso.' : 'Empresa cadastrada com sucesso.', 'success');
  } catch (error) { handleAdminError(error, 'Não foi possível salvar a empresa'); }
  finally { state.companyBusy = false; renderOrganizations(); }
}
async function selectOrganization(organizationId) {
  if (!organizationId || organizationId === state.organizationId) return;
  state.organizationId = organizationId;
  state.organizationName = organizationLabel(currentOrganization());
  renderOrganizations();
  state.tools = [];
  renderTools();
  setStatus('Carregando dados da empresa selecionada…');
  await Promise.all([loadUsers(), loadSettings()]);
  if (state.organizationId === state.activeOrganizationId) await loadTools();
  else {
    renderTools();
    setStatus('Empresa selecionada. Torne-a ativa antes de alterar ou testar acessos de ferramentas.', 'warning');
  }
}
async function activateOrganization(organizationId = state.organizationId) {
  if (!organizationId || state.companyBusy) return;
  const organization = state.organizations.find((item) => item.id === organizationId);
  const confirmed = await confirmAction({
    title: 'Tornar esta empresa ativa?',
    message: `O Portal passará a usar “${organizationLabel(organization)}” como contexto principal deste administrador. Isso alinha concessões e validações de acesso.`,
    danger: false,
  });
  if (!confirmed) return;
  state.companyBusy = true; renderOrganizations(); setStatus('Atualizando empresa ativa da sessão…');
  try {
    await adminWrite(`/api/admin/organizations/${encodeURIComponent(organizationId)}/activate`, { method: 'POST' });
    state.activeOrganizationId = organizationId;
    state.organizationId = organizationId;
    renderOrganizations();
    await Promise.all([loadUsers(), loadSettings(), loadTools()]);
    setStatus('Empresa ativa atualizada. As concessões de ferramentas agora serão feitas neste contexto.', 'success');
  } catch (error) { handleAdminError(error, 'Não foi possível alterar a empresa ativa'); }
  finally { state.companyBusy = false; renderOrganizations(); }
}
async function loadOrganizations(preferredOrganizationId = '') {
  els.companiesTableWrap.setAttribute('aria-busy', 'true');
  const payload = await api('/api/admin/organizations');
  state.organizations = Array.isArray(payload.organizations) ? payload.organizations : [];
  state.organizationPermissions = payload.permissions || {};
  state.activeOrganizationId = String(payload.activeOrganizationId || '');
  const preferred = String(preferredOrganizationId || state.organizationId || state.activeOrganizationId || '');
  state.organizationId = state.organizations.some((item) => item.id === preferred)
    ? preferred
    : (state.organizations[0]?.id || '');
  state.organizationName = organizationLabel(currentOrganization());
  renderOrganizations();
  els.companiesTableWrap.setAttribute('aria-busy', 'false');
}

function roleLabel(role, isRoot = false) { if (isRoot) return 'Administrador raiz'; return role === 'E3I_ADMIN' ? 'Administrador E3I' : 'Operador'; }
function normalizeUser(user) { return { id: String(user.id || ''), name: String(user.name || ''), email: String(user.email || ''), role: user.role === 'E3I_ADMIN' ? 'E3I_ADMIN' : 'OPERATOR', status: user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', mustChangePassword: user.mustChangePassword === true, createdAt: user.createdAt || '', updatedAt: user.updatedAt || '', isSelf: user.isSelf === true, isRoot: user.isRoot === true, organizationId: String(user.organizationId || ''), organizationName: String(user.organizationName || ''), linked: user.linked === true, membershipId: String(user.membershipId || ''), membershipRole: String(user.membershipRole || ''), membershipStatus: String(user.membershipStatus || '') }; }
function userActionButton(label, className, handler, disabled = false) { const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${className}`; b.textContent = label; b.disabled = disabled || state.userBusy; b.addEventListener('click', handler); return b; }
function renderUsers() {
  updateMetrics(); els.usersTableBody.replaceChildren(); els.usersTableWrap.setAttribute('aria-busy', state.userBusy ? 'true' : 'false');
  const query = state.userFilter.trim().toLocaleLowerCase('pt-BR');
  const visible = state.users.filter((user) => (state.userStatus === 'ALL' || user.status === state.userStatus) && (!query || [user.name, user.email, roleLabel(user.role, user.isRoot), user.organizationName, user.organizationId].some((v) => String(v).toLocaleLowerCase('pt-BR').includes(query))));
  if (!visible.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 6; cell.className = 'empty-state'; cell.textContent = state.users.length ? 'Nenhum usuário corresponde aos filtros.' : 'Nenhum usuário encontrado nesta organização.'; row.append(cell); els.usersTableBody.append(row); return; }
  visible.forEach((user) => {
    const row = document.createElement('tr');
    const identity = document.createElement('td'); const name = document.createElement('span'); name.className = 'user-name'; name.textContent = user.name || 'Sem nome'; const email = document.createElement('span'); email.className = 'user-email'; email.textContent = user.email; identity.append(name, email);
    const role = document.createElement('td'); const roleCode = document.createElement('span'); roleCode.className = 'user-role'; roleCode.textContent = roleLabel(user.role, user.isRoot); role.append(roleCode);
    const company = document.createElement('td'); const companyName = document.createElement('span'); companyName.className = 'user-company'; companyName.textContent = user.organizationName || state.organizationName || user.organizationId || state.organizationId || 'Não identificada'; const companyId = document.createElement('span'); companyId.className = 'user-company-id'; companyId.textContent = user.organizationId || state.organizationId || ''; company.append(companyName, companyId, badge(user.linked ? 'Vinculado' : 'Sem vínculo', user.linked ? 'active' : 'pending'));
    const status = document.createElement('td'); status.append(badge(user.status === 'ACTIVE' ? 'Ativo' : 'Suspenso', user.status === 'ACTIVE' ? 'active' : 'suspended'));
    const onboarding = document.createElement('td'); onboarding.append(badge(user.mustChangePassword ? 'Pendente' : 'Concluído', user.mustChangePassword ? 'pending' : 'neutral'));
    const actions = document.createElement('td'); actions.className = 'actions-col'; const bar = document.createElement('div'); bar.className = 'user-actions';
    const protectedAdmin = user.role === 'E3I_ADMIN' && !state.canDelegateAdmin;
    if (!user.linked && state.canManageMemberships) bar.append(userActionButton('Vincular à empresa', 'btn-primary', () => linkUserToOrganization(user), false));
    if (user.linked && state.canManageMemberships) bar.append(userActionButton('Definir como ativa', 'btn-ghost', () => makeUserOrganizationActive(user), false));
    bar.append(userActionButton('Editar', 'btn-ghost', () => openUserDialog(user), protectedAdmin));
    bar.append(userActionButton('Encerrar sessões', 'btn-ghost', () => userCommand(user, 'revoke-sessions', 'Encerrar sessões?', `Todas as sessões ativas de ${user.name || user.email} serão revogadas.`, false), protectedAdmin));
    bar.append(userActionButton('Forçar 1º acesso', 'btn-ghost', () => userCommand(user, 'force-first-login', 'Forçar novo primeiro acesso?', `O usuário ${user.name || user.email} precisará validar o e-mail e definir uma nova senha. As sessões atuais serão encerradas.`, true), protectedAdmin));
    if (user.status === 'ACTIVE') bar.append(userActionButton('Suspender', 'btn-revoke', () => userCommand(user, 'suspend', 'Suspender usuário?', `O acesso de ${user.name || user.email} será bloqueado e suas sessões serão revogadas. O histórico será preservado.`, true), user.isSelf || protectedAdmin || user.isRoot));
    else bar.append(userActionButton('Reativar', 'btn-primary', () => userCommand(user, 'reactivate', 'Reativar usuário?', `O usuário ${user.name || user.email} voltará a poder acessar o Portal conforme suas permissões.`, false), protectedAdmin || user.isRoot));
    actions.append(bar); row.append(identity, role, company, status, onboarding, actions); els.usersTableBody.append(row);
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
  els.userId.value = user?.id || ''; els.userName.value = user?.name || ''; els.userEmail.value = user?.email || ''; els.userRole.value = user?.role || 'OPERATOR'; els.userRole.disabled = !state.canDelegateAdmin; if (els.userOrganization) els.userOrganization.value = user?.organizationName || state.organizationName || user?.organizationId || state.organizationId || 'Não identificada';
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
async function linkUserToOrganization(user) {
  if (state.userBusy || !state.canManageMemberships || user.linked) return;
  const company = user.organizationName || state.organizationName || state.organizationId || 'a empresa ativa';
  const confirmed = await confirmAction({ title: 'Vincular usuário à empresa?', message: `${user.name || user.email} será vinculado a ${company} e essa empresa passará a ser o contexto ativo da conta.`, danger: false });
  if (!confirmed) return;
  state.userBusy = true; renderUsers(); setStatus('Vinculando usuário à empresa…');
  try {
    await adminWrite(`/api/admin/organizations/${encodeURIComponent(state.organizationId)}/members/${encodeURIComponent(user.id)}`, { method: 'PUT', body: { makeActive: false } });
    await loadUsers();
    await loadOrganizations(state.organizationId);
    setStatus(`Usuário vinculado a ${company} com sucesso.`, 'success');
  } catch (error) { handleAdminError(error, 'Não foi possível vincular o usuário à empresa'); }
  finally { state.userBusy = false; renderUsers(); }
}

async function makeUserOrganizationActive(user) {
  if (state.userBusy || !state.canManageMemberships || !user.linked || !state.organizationId) return;
  const company = state.organizationName || organizationLabel(currentOrganization()) || state.organizationId;
  const confirmed = await confirmAction({
    title: 'Definir empresa ativa para o usuário?',
    message: `${company} passará a ser o contexto ativo de ${user.name || user.email}. As sessões abertas desse usuário serão atualizadas para a mesma empresa.`,
    danger: false,
  });
  if (!confirmed) return;
  state.userBusy = true; renderUsers(); setStatus('Atualizando empresa ativa do usuário…');
  try {
    await adminWrite(`/api/admin/organizations/${encodeURIComponent(state.organizationId)}/members/${encodeURIComponent(user.id)}`, { method: 'PUT', body: { makeActive: true } });
    await loadUsers();
    setStatus(`${company} definida como empresa ativa para ${user.name || user.email}.`, 'success');
  } catch (error) { handleAdminError(error, 'Não foi possível definir a empresa ativa do usuário'); }
  finally { state.userBusy = false; renderUsers(); }
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
  if (state.organizationId !== state.activeOrganizationId) {
    setStatus('Defina esta empresa como ativa antes de alterar o acesso às ferramentas.', 'warning');
    return;
  }
  const requestedGrant = !tool.granted;
  if (!requestedGrant && !(await confirmAction({ title: 'Revogar acesso?', message: `A organização ativa deixará de ter acesso a “${toolLabel(tool)}”.`, danger: true }))) return;
  state.busyToolId = tool.id; setStatus(requestedGrant ? 'Liberando acesso…' : 'Revogando acesso…'); renderTools();
  try {
    await api(organizationPath(`/client-tools/${encodeURIComponent(tool.id)}`), {
      method: requestedGrant ? 'PUT' : 'DELETE',
      headers: { 'x-e3i-admin-request': '1' },
      cache: 'no-store',
    });
    await loadTools();
    const persisted = state.tools.find((candidate) => candidate.id === tool.id);
    if (!persisted || Boolean(persisted.granted) !== requestedGrant) {
      throw Object.assign(
        new Error('O servidor não confirmou a alteração de acesso. Recarregue os dados e tente novamente.'),
        { status: 409 },
      );
    }
    setStatus(
      requestedGrant
        ? `Acesso a “${toolLabel(tool)}” liberado e confirmado pelo servidor.`
        : `Acesso a “${toolLabel(tool)}” revogado e confirmado pelo servidor.`,
      'success',
    );
  } catch (error) { handleAdminError(error, 'Não foi possível alterar o acesso'); }
  finally { state.busyToolId = ''; renderTools(); }
}
async function loadTools() {
  els.toolsGrid.setAttribute('aria-busy', 'true');
  const payload = await api('/api/client-tools');
  const clientToolsOrganizationId = String(payload.organizationId || '');
  if (clientToolsOrganizationId) state.activeOrganizationId = clientToolsOrganizationId;
  state.tools = state.organizationId === state.activeOrganizationId && Array.isArray(payload.tools) ? payload.tools : [];
  renderOrganizationContext();
  renderTools();
  els.toolsGrid.setAttribute('aria-busy', 'false');
}
async function loadUsers() { if (!state.organizationId) return; els.usersTableWrap.setAttribute('aria-busy', 'true'); const payload = await api(usersEndpoint()); state.canDelegateAdmin = payload?.permissions?.canDelegateAdmin === true; state.canManageMemberships = payload?.permissions?.canManageMemberships === true; state.organizationName = String(payload?.organization?.name || organizationLabel(currentOrganization()) || ''); state.users = Array.isArray(payload.users) ? payload.users.map(normalizeUser) : []; renderOrganizationContext(); renderUsers(); els.usersTableWrap.setAttribute('aria-busy', 'false'); }
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
els.companySearchInput.addEventListener('input', (e) => { state.companyFilter = e.target.value; renderOrganizations(); });
els.organizationSelect.addEventListener('change', (e) => selectOrganization(e.target.value));
els.activateOrganizationButton.addEventListener('click', () => activateOrganization());
els.createOrganizationButton.addEventListener('click', () => openOrganizationDialog());
els.organizationForm.addEventListener('submit', (e) => { e.preventDefault(); saveOrganization(); });
q('[data-organization-cancel]').addEventListener('click', () => els.organizationDialog.close());
els.searchInput.addEventListener('input', (e) => { state.filter = e.target.value; renderTools(); });
els.userSearchInput.addEventListener('input', (e) => { state.userFilter = e.target.value; renderUsers(); });
els.userStatusFilter.addEventListener('change', (e) => { state.userStatus = e.target.value; renderUsers(); });
els.createUserButton.addEventListener('click', () => openUserDialog());
els.userForm.addEventListener('submit', (e) => { e.preventDefault(); saveUser(); });
q('[data-user-cancel]').addEventListener('click', () => els.userDialog.close());
els.reloadSettings.addEventListener('click', () => loadSettings({ announce: true }));
els.saveSettings.addEventListener('click', saveSettings);

(async function boot() {
  setStatus('Validando sessão administrativa e carregando empresas…');
  try {
    await loadOrganizations();
    if (!state.organizationId) {
      renderTools();
      renderUsers();
      renderSettings();
      setStatus('Nenhuma empresa está disponível. Cadastre uma empresa para iniciar a gestão.', 'warning');
      return;
    }
    await Promise.all([loadUsers(), loadSettings()]);
    await loadTools();
    setStatus(
      state.organizationId === state.activeOrganizationId
        ? 'Administração central carregada no contexto correto da empresa.'
        : 'Administração carregada. A empresa em gestão difere da empresa ativa da sessão.',
      state.organizationId === state.activeOrganizationId ? 'success' : 'warning',
    );
  } catch (error) { handleAdminError(error, 'Não foi possível carregar a administração central'); }
})();
