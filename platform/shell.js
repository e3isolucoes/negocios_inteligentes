import {
  getAvailableModules,
  getDefaultModule,
  getModuleById,
} from '../modules/registry.js';

const PLATFORM_NAME = 'E3I Negócios Inteligentes';
let mountedModule = null;

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

function resolveActiveModule() {
  return getModuleById(moduleIdFromLocation()) || getDefaultModule();
}

function resolveModuleEntrypoint(entrypoint) {
  const url = new URL(entrypoint, window.location.href);

  // O módulo continua responsável por autenticação e recuperação.
  // O shell apenas encaminha os parâmetros existentes.
  const query = new URLSearchParams(window.location.search);
  query.forEach((value, key) => url.searchParams.set(key, value));

  if (hasForwardableAuthFragment()) {
    url.hash = window.location.hash;
  }

  return url.toString();
}

function cleanPlatformLaunchUrl(activeModule) {
  const query = new URLSearchParams(window.location.search);
  query.delete('portal_sso_token');
  query.delete('portal_sso_type');

  const queryString = query.toString();
  const cleanUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}#${activeModule.id}`;
  window.history.replaceState({}, document.title, cleanUrl);
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

function renderShell(activeModule) {
  const root = document.getElementById('platformRoot');
  const modules = getAvailableModules();

  if (mountedModule) {
    const currentContainer = document.getElementById('moduleStage');
    mountedModule.unmount(currentContainer);
    mountedModule = null;
  }

  if (!activeModule) {
    root.innerHTML = `
      <main class="platform-empty">
        <h1>${PLATFORM_NAME}</h1>
        <p>Nenhum módulo está disponível no momento.</p>
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

  const receivedAuthLaunch = hasForwardableAuthFragment()
    || new URLSearchParams(window.location.search).has('portal_sso_token');

  const stage = document.getElementById('moduleStage');
  activeModule.mount(stage, {
    resolveEntrypoint: resolveModuleEntrypoint,
    onLoad: () => {
      if (receivedAuthLaunch) cleanPlatformLaunchUrl(activeModule);
    },
  });
  mountedModule = activeModule;
}

function activateFromLocation() {
  renderShell(resolveActiveModule());
}

window.addEventListener('hashchange', activateFromLocation);
activateFromLocation();
