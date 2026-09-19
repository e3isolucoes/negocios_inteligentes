import { STATE } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

const STATUS = {
  trial: { label: 'Degustação', tone: 'trial' },
  full: { label: 'Acesso completo', tone: 'full' },
  suspended: { label: 'Suspenso', tone: 'suspended' },
};

function accessMeta(workspace) {
  return STATUS[workspace.access_status] || STATUS.suspended;
}

function formatDate(value) {
  if (!value) return 'Não definida';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR').format(parsed);
}

function workspaceUsers(workspaceId) {
  return STATE.profiles.filter((profile) => profile.workspace_id === workspaceId);
}

function workspaceCard(workspace) {
  const { label, tone } = accessMeta(workspace);
  const users = workspaceUsers(workspace.id);
  const admins = users.filter((profile) => profile.role === 'admin');
  const activeUsers = users.filter((profile) => profile.active !== false).length;
  const adminNames = admins.map((profile) => profile.display_name || profile.email).filter(Boolean);
  const safeId = escapeHtml(workspace.id);
  const initials = workspace.name.trim().slice(0, 2).toUpperCase() || 'EM';
  const validity = workspace.access_status === 'trial'
    ? `Teste até ${formatDate(workspace.trial_ends_at)}`
    : (workspace.access_status === 'full' ? 'Contrato ativo' : 'Acesso bloqueado');

  return `<article class="system-company-card">
    <div class="system-company-head">
      <div class="company-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
      <div class="system-company-identity"><h3>${escapeHtml(workspace.name)}</h3><p>${escapeHtml(workspace.document || 'CNPJ não informado')}</p></div>
      <span class="access-chip ${tone}"><i></i>${label}</span>
    </div>
    <div class="system-company-health"><span><strong>${activeUsers}</strong> usuários ativos</span><span><strong>${admins.length}</strong> administradores</span></div>
    <dl class="system-company-meta">
      <div><dt>Administrador responsável</dt><dd>${adminNames.length ? escapeHtml(adminNames.join(', ')) : '<span class="system-warning">Administrador pendente</span>'}</dd></div>
      <div><dt>Plano e vigência</dt><dd>${escapeHtml(validity)}</dd></div>
    </dl>
    <div class="system-company-actions" aria-label="Alterar acesso de ${escapeHtml(workspace.name)}">
      <button class="system-action-btn${tone === 'trial' ? ' selected' : ''}" data-action="workspace-access" data-id="${safeId}" data-status="trial" type="button">Degustação</button>
      <button class="system-action-btn${tone === 'full' ? ' selected' : ''}" data-action="workspace-access" data-id="${safeId}" data-status="full" type="button">Liberar completo</button>
      <button class="system-action-btn danger${tone === 'suspended' ? ' selected' : ''}" data-action="workspace-access" data-id="${safeId}" data-status="suspended" type="button">Suspender</button>
    </div>
  </article>`;
}

export function renderSystemAdmin() {
  const workspaces = STATE.workspaces || [];
  const profiles = STATE.profiles || [];
  const active = workspaces.filter((workspace) => workspace.access_status !== 'suspended').length;
  const trials = workspaces.filter((workspace) => workspace.access_status === 'trial').length;
  const suspended = workspaces.filter((workspace) => workspace.access_status === 'suspended').length;
  const activeUsers = profiles.filter((profile) => profile.active !== false).length;
  const withoutAdmin = workspaces.filter((workspace) => !workspaceUsers(workspace.id).some((profile) => profile.role === 'admin')).length;
  const cards = workspaces.map(workspaceCard).join('');

  return `<main class="system-admin">
    <header class="system-admin-hero">
      <div class="system-hero-copy"><span class="system-eyebrow"><i></i> Central de controle</span><h2>Administração da plataforma</h2><p>Visão global de clientes, acessos e configurações para manter toda a operação E3I segura e organizada.</p></div>
      <div class="system-hero-side"><span class="super-badge">SUPERUSUÁRIO</span><small>Privilégios globais habilitados</small></div>
    </header>

    <section class="system-stats" aria-label="Resumo da plataforma">
      <div><span class="system-stat-icon blue">▦</span><p><strong>${workspaces.length}</strong><span>Empresas cadastradas</span></p><small>${active} com acesso ativo</small></div>
      <div><span class="system-stat-icon green">✓</span><p><strong>${activeUsers}</strong><span>Usuários ativos</span></p><small>Em todos os espaços</small></div>
      <div><span class="system-stat-icon amber">◷</span><p><strong>${trials}</strong><span>Em degustação</span></p><small>Conversões em acompanhamento</small></div>
      <div><span class="system-stat-icon red">!</span><p><strong>${suspended + withoutAdmin}</strong><span>Pontos de atenção</span></p><small>${suspended} suspensos · ${withoutAdmin} sem admin</small></div>
    </section>

    <section class="system-control-grid">
      <div class="system-create">
        <div class="system-panel-heading"><span class="system-panel-icon">＋</span><div><h3>Cadastrar nova empresa</h3><p>Crie um ambiente isolado e defina o acesso inicial do cliente.</p></div></div>
        <div class="system-create-fields">
          <div class="field"><label for="workspaceName">Razão social</label><input id="workspaceName" autocomplete="organization" placeholder="Ex.: Empresa Contábil Ltda." /></div>
          <div class="field"><label for="workspaceDocument">CNPJ</label><input id="workspaceDocument" inputmode="numeric" maxlength="18" placeholder="00.000.000/0000-00" /></div>
          <div class="field"><label for="workspaceAccess">Acesso inicial</label><select id="workspaceAccess"><option value="trial">Degustação · 14 dias</option><option value="full">Acesso completo</option><option value="suspended">Sem acesso</option></select></div>
          <button class="btn-primary system-create-btn" data-action="workspace-create" type="button">Criar empresa <span aria-hidden="true">→</span></button>
        </div>
      </div>
      <aside class="system-shortcuts" aria-label="Atalhos administrativos">
        <div class="system-panel-heading"><span class="system-panel-icon">⚙</span><div><h3>Gestão da ferramenta</h3><p>Acesse os controles operacionais.</p></div></div>
        <div class="system-shortcut-list">
          <button data-action="tab" data-tab="manage" type="button"><span>♙</span><div><strong>Usuários e permissões</strong><small>Equipe, papéis e acessos</small></div><b>›</b></button>
          <button data-action="tab" data-tab="manage" type="button"><span>☷</span><div><strong>Catálogos e regras</strong><small>Obrigações, regimes e feriados</small></div><b>›</b></button>
          <button data-action="tab" data-tab="dashboard" type="button"><span>⌁</span><div><strong>Indicadores executivos</strong><small>Desempenho da operação</small></div><b>›</b></button>
        </div>
      </aside>
    </section>

    <section class="system-portfolio">
      <div class="system-section-title"><div><span class="system-eyebrow">CARTEIRA DE CLIENTES</span><h3>Empresas e acessos</h3><p>Administre planos, vigências e responsáveis de cada ambiente.</p></div><span class="system-result-count">${workspaces.length} ${workspaces.length === 1 ? 'empresa' : 'empresas'}</span></div>
      <div class="system-company-grid">${cards || '<div class="system-empty"><span>▦</span><h3>Nenhuma empresa cadastrada</h3><p>Use o formulário acima para criar o primeiro ambiente.</p></div>'}</div>
    </section>
  </main>`;
}
