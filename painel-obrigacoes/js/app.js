import { isSupabaseConfigured } from './supabaseClient.js';
import { STATE, isAdmin, hasAdministrationAccess } from './state.js';
import {
  onAuthStateChange, getSession, fetchMyProfile, signOut, isPasswordRecoveryUrl, setSession,
  completePortalSso,
} from './api/auth.js';
import { bootstrapPortalSession } from './api/portalAuth.js';
import { loadAll, doChangeModuleAccess, doChangeAdministrationAccess } from './data.js?v=20260919-design-system-v2';
import { render } from './render.js?v=20260919-design-system-v2';
import {
  showLogin, wireLogin, showResetPasswordScreen, wireResetPasswordScreen,
} from './ui/login.js';
import { showToast } from './ui/toast.js';
import { awsData, isAwsDataBackend } from './api/awsDataClient.js';

function legacyRole(role) {
  return ({ member: 'membro', manager: 'gestor' })[role] || role;
}

function wireModalBackdrop() {
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-backdrop" id="modalBackdrop" hidden><div class="modal" id="modal"></div></div>');
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') {
      import('./ui/modal.js?v=20260919-design-system-v2').then(({ closeModal }) => closeModal());
      import('./ui/ruleModal.js').then(({ closeRuleModal }) => closeRuleModal());
    }
  });
}

function wireMainModuleCompatibility() {
  const app = document.getElementById('app');
  app.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="clear-filters"]')) {
      // O render.js limpa os filtros tradicionais. Aqui também removemos o
      // recorte de módulo, para "Remover filtros" realmente voltar à visão total.
      STATE.activeModule = 'all';
      return;
    }

    const button = event.target.closest('[data-action="module"]');
    if (!button) return;
    STATE.view = 'board';
    STATE.activeModule = button.getAttribute('data-module') || 'all';
    STATE.filters.category = 'all';
    render();
  });
  app.addEventListener('change', (event) => {
    const moduleFilter = event.target.closest('select[data-action="module-filter"]');
    if (moduleFilter) {
      STATE.view = 'board';
      STATE.activeModule = moduleFilter.value || 'all';
      render();
      return;
    }

    const filterSelect = event.target.closest('select[data-action="filter-select"]');
    if (filterSelect) {
      const key = filterSelect.getAttribute('data-filter');
      if (key) STATE.filters[key] = filterSelect.value || 'all';
      render();
      return;
    }

    const adminToggle = event.target.closest('input[data-action="team-administration-access"]');
    if (adminToggle) {
      if (!isAdmin()) return;
      doChangeAdministrationAccess(adminToggle.getAttribute('data-id'), adminToggle.checked, render);
      return;
    }

    const toggle = event.target.closest('input[data-action="team-module-access"]');
    if (!toggle || !hasAdministrationAccess()) return;
    const profileId = toggle.getAttribute('data-id');
    const checked = Array.from(document.querySelectorAll(`input[data-action="team-module-access"][data-id="${profileId}"]:checked`)).map((input) => input.value);
    doChangeModuleAccess(profileId, checked, render);
  });
}

async function enterApp(session) {
  STATE.session = { id: session.user.id, email: session.user.email };
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('resetPasswordScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').innerHTML = '<div class="loading">Carregando painel…</div>';

  try {
    STATE.profile = await fetchMyProfile(session.user.id);
  } catch (err) {
    console.error('Falha ao carregar perfil', err);
    STATE.profile = { role: 'membro', display_name: session.user.email, active: true };
  }

  if (isAwsDataBackend()) {
    try {
      const access = await awsData.me();
      STATE.profile = {
        ...STATE.profile,
        workspace_id: access.workspaceId,
        role: legacyRole(access.role),
        module_grants: access.moduleGrants,
        active: true,
      };
    } catch (error) {
      console.error('Acesso AWS recusado', { status: error.status, requestId: error.requestId });
      document.getElementById('app').innerHTML = '<div class="empty">Seu acesso ao Painel de Obrigações não está liberado para esta empresa.<br/><br/>'
        + '<button class="btn-primary" id="retryAwsAccess">Verificar novamente</button></div>';
      document.getElementById('retryAwsAccess')?.addEventListener('click', () => enterApp(session));
      showToast(error.message || 'Acesso à empresa não concedido.', 'error');
      return;
    }
  }

  if (STATE.profile?.active === false) {
    await signOut();
    showLogin('Sua conta foi revogada. Fale com um administrador do painel.');
    return;
  }

  try {
    await loadAll();
    render();
  } catch (err) {
    console.error(err);
    document.getElementById('app').innerHTML = '<div class="empty">Não foi possível carregar o painel agora. <br/><br/>'
      + '<button class="btn-primary" id="retryBoot">Tentar de novo</button></div>';
    document.getElementById('retryBoot')?.addEventListener('click', () => enterApp(session));
    showToast('Falha ao conectar com o serviço de dados. Verifique sua internet.', 'error');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.error('Falha ao registrar service worker (não impede o uso do painel)', err);
  });
}

async function boot() {
  let passwordRecoveryPending = isPasswordRecoveryUrl();

  wireModalBackdrop();
  wireMainModuleCompatibility();
  registerServiceWorker();

  if (!isAwsDataBackend() && !isSupabaseConfigured()) {
    document.getElementById('loginScreen').innerHTML = '<div class="login-card"><img class="reset-brand-logo" src="icons/e3l-solucoes.svg" alt="E3I Soluções"><h1>Configuração pendente</h1>'
      + '<p>Este projeto ainda não tem as credenciais do Supabase preenchidas. Abra o arquivo js/config.js em um editor de texto, '
      + 'preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do seu projeto '
      + '(Project Settings → API no painel do Supabase). Veja o SETUP.md para o passo a passo completo.</p></div>';
    return;
  }

  wireLogin();
  wireResetPasswordScreen(() => {
    getSession().then((res) => {
      if (res.data.session) enterApp(res.data.session);
      else showLogin('Senha redefinida. Entre com a nova senha.');
    });
  });

  try {
    const portalSession = await completePortalSso();
    if (portalSession) { await enterApp(portalSession); return; }
  } catch (error) {
    console.error('Falha no acesso único do portal', error);
    showLogin(error.message || 'O acesso automático expirou. Volte ao Portal E3I e abra a ferramenta novamente.');
    return;
  }

  onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') passwordRecoveryPending = true;
    if (passwordRecoveryPending) { showResetPasswordScreen(); return; }
    if (session) { enterApp(session); } else { showLogin(); }
  });
  const embeddedPortalSession = await bootstrapPortalSession({ restoreSession: setSession });
  if (embeddedPortalSession) { await enterApp(embeddedPortalSession); return; }
  getSession().then((res) => {
    if (passwordRecoveryPending) showResetPasswordScreen();
    else if (!res.data.session) showLogin();
  });
}

boot();
