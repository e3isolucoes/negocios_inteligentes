import {
  getAvailableModules,
  getDefaultModule,
  getModuleById,
} from '../modules/registry.js';
import {
  completePortalSso,
  getAccessToken,
} from '../painel-obrigacoes/js/api/auth.js';

const PLATFORM_NAME = 'E3I Negócios Inteligentes';
const SESSION_STORAGE_KEY = 'e3i.cognito.session';

let mountedModule = null;
let accessState = {
  authenticated: false,
  workspaceId: null,
  entitlements: new Set(),
  error: null,
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function rawHash() {
  return window.location.hash.replace(/^#/, '').trim();
}

function launchFragmentParams() {
  return new URLSearchParams(rawHash());
}

function hasPortalLaunchCode() {
  return launchFragmentParams().has('portal_sso_code');
}

function hasForwardableAuthFragment() {
  const fragment = launchFragmentParams();
  return fragment.has('portal_sso_code')
    || fragment.get('type') === 'recovery'
    || fragment.has('access_token')
    || fragment.has('refresh_token');
}

function moduleIdFromLocation() {
  if (hasForwardableAuthFragment()) return '';
  return rawHash().replace(/^\//, '');
}

function registryContext() {
  return { entitlements: accessState.entitlements };
}

function resolveActiveModule() {
  return getModuleById(moduleIdFromLocation(), registryContext())
    || getDefaultModule(registryContext());
}

function resolveModuleEntrypoint(entrypoint) {
  const url = new URL(entrypoint, window.location.href);
  const query = new URLSearchParams(window.location.search);
  query.forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

function apiBase() {
  return String(globalThis.E3I_CONFIG?.awsApiBase || '').replace(/\/$/, '');
}

async function platformRequest(path, { workspaceId } = {}) {
  const base = apiBase();
  if (!base) throw new Error('Backend AWS da plataforma não configurado.');

  const token = await getAccessToken();
  if (!token) {
    throw Object.assign(new Error('Sessão não autenticada.'), { status: 401 });
  }

  const response = await fetch(`${base}/v1/${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
    },
    credentials: 'omit',
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error || 'Falha ao validar acesso aos módulos.'),
      { status: response.status, requestId: payload.requestId },
    );
  }
  return payload;
}

async function refreshPlatformAccess() {
  try {
    const token = await getAccessToken();
    if (!token) {
      accessState = {
        authenticated: false,
        workspaceId: null,
        entitlements: new Set(),
        error: null,
      };
      return;
    }

    const me = await platformRequest('me');
    const workspaceId = me.workspaceId;
    const result = await platformRequest(
      `workspaces/${encodeURIComponent(workspaceId)}/entitlements`,
      { workspaceId },
    );

    const active = new Set(
      (result.items || [])
        .filter((item) => item.status === 'ativo' && item.moduleId)
        .map((item) => item.moduleId),
    );

    accessState = {
      authenticated: true,
      workspaceId,
      entitlements: active,
      error: null,
    };
  } catch (error) {
    accessState = {
      authenticated: error.status !== 401,
      workspaceId: null,
      entitlements: new Set(),
      error,
    };
  }
}

function renderModuleNavigation(modules, activeId) {
  return modules.map((module) => {
    const active = module.id === activeId;
    return `
      <button
        class="module-nav-item${active ? ' is-active' : ''}"
        type="button"
        data-module-id="${escapeHtml(module.id)}"
        aria-current="${active ? 'page' : 'false'}"
      >
        <span class="module-nav-icon" aria-hidden="true">${escapeHtml(module.icon || '•')}</span>
        <span class="module-nav-copy">
          <strong>${escapeHtml(module.shortName || module.name)}</strong>
          <small>${escapeHtml(module.description || '')}</small>
        </span>
      </button>
    `;
  }).join('');
}

function emptyMessage() {
  if (accessState.error) {
    return 'Não foi possível validar os módulos contratados agora. Tente novamente pelo Portal E3I.';
  }
  if (!accessState.authenticated) {
    return 'Acesse pelo Portal E3I para carregar os módulos contratados pela sua empresa.';
  }
  return 'Nenhum módulo contratado está ativo para este workspace.';
}

function renderShell(activeModule) {
  const root = document.getElementById('platformRoot');
  const modules = getAvailableModules(registryContext());

  if (mountedModule) {
    const currentContainer = document.getElementById('moduleStage');
    mountedModule.unmount(currentContainer);
    mountedModule = null;
  }

  if (!activeModule) {
    const portalOrigin = escapeHtml(globalThis.E3I_CONFIG?.portalOrigin || 'https://portal.e3isolucoes.com.br/');
    root.innerHTML = `
      <main class="platform-empty">
        <h1>${PLATFORM_NAME}</h1>
        <p>${escapeHtml(emptyMessage())}</p>
        <p><a href="${portalOrigin}">Acessar o Portal E3I</a></p>
      </main>
    `;
    return;
  }

  root.innerHTML = `
    <div class="platform-shell">
      <aside class="platform-sidebar" aria-label="Navegação da plataforma">
        <div class="platform-brand">
          <img src="./painel-obrigacoes/icons/e3l-solucoes.svg" alt="E3I Soluções" />
          <div>
            <span>E3I</span>
            <strong>Negócios Inteligentes</strong>
          </div>
        </div>

        <div class="sidebar-section-label">Módulos</div>
        <nav class="module-nav" aria-label="Módulos disponíveis">
          ${renderModuleNavigation(modules, activeModule.id)}
        </nav>

        <div class="platform-sidebar-footer">
          <span>Plataforma modular</span>
          <small>E3I Soluções</small>
        </div>
      </aside>

      <main class="platform-main">
        <header class="platform-topbar">
          <div>
            <span class="platform-eyebrow">Módulo ativo · ${escapeHtml(activeModule.area)}</span>
            <h1>${escapeHtml(activeModule.name)}</h1>
          </div>
          <div class="platform-name">${PLATFORM_NAME}</div>
        </header>

        <section
          class="module-stage"
          id="moduleStage"
          aria-label="${escapeHtml(activeModule.name)}"
        ></section>
      </main>
    </div>
  `;

  root.querySelectorAll('[data-module-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextId = button.getAttribute('data-module-id');
      if (nextId && nextId !== activeModule.id) window.location.hash = nextId;
    });
  });

  const stage = document.getElementById('moduleStage');
  activeModule.mount(stage, {
    resolveEntrypoint: resolveModuleEntrypoint,
  });
  mountedModule = activeModule;
}

function activateFromLocation() {
  renderShell(resolveActiveModule());
}

async function reloadAccessAndRender() {
  await refreshPlatformAccess();
  activateFromLocation();
}

async function initializePlatform() {
  if (hasPortalLaunchCode()) {
    try {
      await completePortalSso(window.location);
    } catch (error) {
      accessState = {
        authenticated: false,
        workspaceId: null,
        entitlements: new Set(),
        error,
      };
      activateFromLocation();
      return;
    }
  }

  await reloadAccessAndRender();
}

window.addEventListener('hashchange', activateFromLocation);
window.addEventListener('storage', (event) => {
  if (event.key === SESSION_STORAGE_KEY) reloadAccessAndRender();
});

initializePlatform();
