/**
 * Contrato fechado de módulos da E3I Negócios Inteligentes.
 *
 * Cada módulo precisa declarar identidade, área, entitlement e ciclo de vida.
 * O shell conhece somente este contrato; regras internas continuam encapsuladas
 * dentro de cada módulo.
 */

const MODULE_ID = /^[a-z][a-z0-9-]{1,63}$/;

function validateModule(module) {
  if (!module || !MODULE_ID.test(module.id || '')) {
    throw new TypeError('Módulo com identificador inválido.');
  }
  if (!module.name || typeof module.name !== 'string') {
    throw new TypeError(`Módulo ${module.id} precisa declarar name.`);
  }
  if (!module.area || typeof module.area !== 'string') {
    throw new TypeError(`Módulo ${module.id} precisa declarar area.`);
  }
  if (!module.requiredEntitlement || typeof module.requiredEntitlement !== 'string') {
    throw new TypeError(`Módulo ${module.id} precisa declarar requiredEntitlement.`);
  }
  if (typeof module.mount !== 'function') {
    throw new TypeError(`Módulo ${module.id} precisa implementar mount(container, context).`);
  }
  if (typeof module.unmount !== 'function') {
    throw new TypeError(`Módulo ${module.id} precisa implementar unmount(container).`);
  }
}

function buildModule(definition) {
  validateModule(definition);
  return Object.freeze(definition);
}

function buildModuleUrl(entrypoint, context = {}) {
  if (typeof context.resolveEntrypoint === 'function') {
    return context.resolveEntrypoint(entrypoint);
  }
  return new URL(entrypoint, window.location.href).toString();
}

const obrigacoesModule = buildModule({
  id: 'obrigacoes',
  name: 'Obrigações',
  shortName: 'Obrigações',
  description: 'Prazos, responsáveis, evidências e acompanhamento da operação.',
  icon: '✓',
  area: 'fiscal',
  requiredEntitlement: 'obrigacoes',

  mount(container, context = {}) {
    if (!container) throw new TypeError('Container obrigatório para montar o módulo obrigações.');

    container.replaceChildren();
    container.dataset.moduleId = this.id;

    const loading = document.createElement('div');
    loading.className = 'module-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = `Carregando ${this.name}…`;

    const frame = document.createElement('iframe');
    frame.className = 'module-frame';
    frame.title = this.name;
    frame.loading = 'eager';
    frame.src = buildModuleUrl('./painel-obrigacoes/index.html', context);

    frame.addEventListener('load', () => {
      loading.classList.add('is-hidden');
      context.onLoad?.({ module: this, frame });
    }, { once: true });

    container.append(loading, frame);
    return frame;
  },

  unmount(container) {
    if (!container) return;
    container.replaceChildren();
    delete container.dataset.moduleId;
  },
});

export const MODULE_REGISTRY = Object.freeze([
  obrigacoesModule,
]);

export function getAvailableModules(context = {}) {
  const entitlements = context.entitlements;

  // A aplicação do entitlement será feita pelo motor de permissões da plataforma.
  // Enquanto ele não for injetado, preservamos o comportamento atual do módulo.
  if (!(entitlements instanceof Set)) return MODULE_REGISTRY;

  return MODULE_REGISTRY.filter((module) => entitlements.has(module.requiredEntitlement));
}

export function getModuleById(id, context = {}) {
  return getAvailableModules(context).find((module) => module.id === id) || null;
}

export function getDefaultModule(context = {}) {
  return getAvailableModules(context)[0] || null;
}
