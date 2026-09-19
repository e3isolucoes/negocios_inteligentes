import { STATE, isSuperUser } from '../state.js';
import { escapeHtml } from '../dateUtils.js';
import { ADMINISTRATIVE_MODULES } from '../constants.js';

function renderCredentialsBox() {
  const cred = STATE.pendingNewUserCredentials;
  if (!cred) return '';
  return '<div class="credentials-box">'
    + '<p><strong>Conta criada.</strong> Anote a senha temporária agora — ela não será mostrada de novo. '
    + 'Combine com a pessoa uma forma segura de repassar (não fica salva em lugar nenhum do painel).</p>'
    + `<div class="field"><label>E-mail</label><input type="text" readonly value="${escapeHtml(cred.email)}" /></div>`
    + `<div class="field"><label>Senha temporária</label><input type="text" readonly value="${escapeHtml(cred.password)}" /></div>`
    + '<div class="modal-actions" style="margin-top:10px;">'
      + '<div><button type="button" class="icon-btn" data-action="copy-new-user-password">Copiar senha</button></div>'
      + '<div class="right"><button type="button" class="btn-primary" data-action="dismiss-new-user-credentials">Ok, anotei</button></div>'
    + '</div>'
  + '</div>';
}

function renderCreateUserForm() {
  const workspaceOptions = STATE.workspaces.map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
  return '<div class="mgmt-create-user">'
    + '<div class="field"><label>Nome</label><input type="text" id="newUserName" placeholder="Nome da pessoa" /></div>'
    + '<div class="field"><label>E-mail</label><input type="email" id="newUserEmail" placeholder="pessoa@empresa.com" /></div>'
    + '<div class="field"><label>Senha temporária <span class="mgmt-sub" style="display:inline;">(só para conta nova — ignorada se o e-mail já existir)</span></label>'
      + '<div style="display:flex;gap:8px;">'
        + '<input type="text" id="newUserPassword" placeholder="Mín. 6 caracteres" style="flex:1;" />'
        + '<button type="button" class="icon-btn" data-action="user-generate-password">Gerar</button>'
      + '</div>'
    + '</div>'
    + '<div class="field"><label>Papel de acesso</label><select id="newUserRole">'
      + '<option value="membro">Membro</option>'
      + '<option value="gestor">Gestor</option>'
      + '<option value="admin">Admin</option>'
    + '</select></div>'
    + (isSuperUser() ? '<div class="field"><label>Vínculo empresarial</label><select id="newUserWorkspace" required><option value="">Selecione a empresa</option>' + workspaceOptions + '</select><small class="mgmt-sub">Os dados cadastrados por esta pessoa ficarão isolados no ambiente da empresa selecionada.</small></div>' : '')
    + '<button class="btn-primary" type="button" data-action="user-create">Salvar</button>'
    + '<p class="mgmt-sub" style="margin-top:8px;">'
      + 'Se o e-mail já tiver uma conta cadastrada na lista abaixo, este formulário <strong>atualiza</strong> o nome e o papel '
      + 'dessa conta em vez de criar outra (e-mail duplicado sempre falharia). Só cria conta nova quando o e-mail ainda não existe. '
      + 'Para trocar a <strong>senha</strong> de quem já tem conta, use "Redefinir senha" na lista abaixo — o app não consegue '
      + 'definir a senha de outra pessoa diretamente, só mandar um link para ela escolher uma nova.'
    + '</p>'
    + '<p class="mgmt-sub">'
      + 'Dependendo da configuração de e-mail do projeto Supabase, a pessoa pode precisar confirmar o e-mail antes '
      + 'de conseguir entrar (link enviado automaticamente). Se o primeiro acesso não funcionar, confirme manualmente '
      + 'em Authentication → Users no painel do Supabase.'
    + '</p>'
  + '</div>';
}

export function renderTeamManage() {
  let html = renderCredentialsBox();
  html += '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Crie contas novas abaixo, ou digite o e-mail de quem já tem conta para <strong>editar</strong> nome/papel. '
    + 'Para tirar o acesso de alguém sem apagar a conta, use <strong>Revogar acesso</strong> na lista — dá para reativar depois.'
    + '</div>';
  html += renderCreateUserForm();

  if (!STATE.profiles.length) {
    html += '<div class="empty">Nenhum perfil encontrado.</div>';
    return html;
  }

  const list = STATE.profiles.slice().sort((a, b) => a.email.localeCompare(b.email));
  html += list.map((p) => {
    const isMe = p.id === STATE.session?.id;
    const isActive = p.active !== false;
    const roleLabel = p.role === 'admin' ? 'Admin' : (p.role === 'gestor' ? 'Gestor' : 'Membro');
    const workspace = STATE.workspaces.find((item) => item.id === p.workspace_id);
    const workspaceControl = isSuperUser() && p.role !== 'super_admin'
      ? `<label class="team-workspace-control">Vínculo empresarial<select class="icon-btn" data-action="team-change-workspace" data-id="${p.id}" aria-label="Alterar vínculo empresarial de ${escapeHtml(p.display_name || p.email)}"><option value="">Sem vínculo</option>${STATE.workspaces.map((item) => `<option value="${item.id}" ${item.id === p.workspace_id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>`
      : '';
    const grantedModules = Array.isArray(p.module_access) ? p.module_access : ADMINISTRATIVE_MODULES.map((module) => module.key);
    const moduleControl = ['admin', 'super_admin'].includes(p.role)
      ? '<div class="mgmt-sub">Módulos: <strong>acesso administrativo completo</strong></div>'
      : `<fieldset class="team-module-access"><legend>Liberação por módulo</legend>${ADMINISTRATIVE_MODULES.map((module) => `<label><input type="checkbox" data-action="team-module-access" data-id="${p.id}" value="${module.key}" ${grantedModules.includes(module.key) ? 'checked' : ''}> ${escapeHtml(module.label)}</label>`).join('')}</fieldset>`;
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name">${escapeHtml(p.display_name || p.email)}${isMe ? ' <span class="badge" style="border-color:var(--accent);color:var(--accent);">Você</span>' : ''}</div>`
        + `<div class="mgmt-sub">${escapeHtml(p.email)} · <span class="role-badge ${p.role !== 'membro' ? 'admin' : ''}">${roleLabel}</span>`
          + (isActive ? '' : ' · <span class="badge" style="border-color:var(--red);color:var(--red);">Revogado</span>')
        + '</div>'
        + `<div class="mgmt-sub">Empresa vinculada: <strong>${escapeHtml(workspace?.name || 'nenhuma')}</strong></div>`
        + moduleControl
      + '</div>'
      + '<div class="mgmt-actions">'
        + workspaceControl
        + `<select class="icon-btn" data-action="team-change-role" data-id="${p.id}" aria-label="Alterar papel de ${escapeHtml(p.display_name || p.email)}"><option value="membro" ${p.role === 'membro' ? 'selected' : ''}>Membro</option><option value="gestor" ${p.role === 'gestor' ? 'selected' : ''}>Gestor</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option></select>`
        + `<button class="icon-btn" data-action="team-send-reset" data-id="${p.id}">Redefinir senha</button>`
        + `<button class="icon-btn ${isActive ? 'danger' : ''}" data-action="team-toggle-active" data-id="${p.id}" data-next-active="${!isActive}">${isActive ? 'Revogar acesso' : 'Reativar acesso'}</button>`
      + '</div>'
    + '</div>';
  }).join('');

  return html;
}
