const MODULE_ID = /^[a-z][a-z0-9-]{1,63}$/;

function validateModule(module) {
  if (!module || !MODULE_ID.test(module.id || '')) throw new TypeError('Módulo com identificador inválido.');
  if (typeof module.render !== 'function') throw new TypeError(`Módulo ${module.id} precisa implementar render(context).`);
  if (module.canAccess && typeof module.canAccess !== 'function') throw new TypeError(`Módulo ${module.id} possui canAccess inválido.`);
  if (module.mount && typeof module.mount !== 'function') throw new TypeError(`Módulo ${module.id} possui mount inválido.`);
  if (module.requiredGrant && !MODULE_ID.test(module.requiredGrant)) throw new TypeError(`Módulo ${module.id} possui concessão inválida.`);
}

function isAccessible(module, context) {
  const grants = context?.moduleGrants;
  if (module.requiredGrant && grants instanceof Set && !grants.has(module.requiredGrant)) return false;
  return module.canAccess?.(context) !== false;
}

export function hasModuleGrant(profile, grant) {
  return !Array.isArray(profile?.module_grants) || profile.module_grants.includes(grant);
}

export class ModuleRegistry {
  #modules = new Map();
  #enabled;

  constructor({ enabledModules } = {}) {
    this.#enabled = enabledModules?.length ? new Set(enabledModules) : null;
  }

  register(module) {
    validateModule(module);
    if (this.#modules.has(module.id)) throw new Error(`Módulo duplicado: ${module.id}.`);
    this.#modules.set(module.id, Object.freeze({ order: 100, ...module }));
    return this;
  }

  get(id, context) {
    const module = this.#modules.get(id);
    if (!module || (this.#enabled && !this.#enabled.has(id))) return null;
    return isAccessible(module, context) ? module : null;
  }

  available(context) {
    return [...this.#modules.values()]
      .filter((module) => (!this.#enabled || this.#enabled.has(module.id)) && isAccessible(module, context))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
}

export function moduleContext({ state, permissions }) {
  const configuredGrants = state.profile?.module_grants;
  return Object.freeze({
    state,
    permissions: Object.freeze({ ...permissions }),
    workspaceId: state.profile?.workspace_id || null,
    userId: state.session?.id || null,
    // Ausência preserva compatibilidade. Um array presente é deny-by-default.
    moduleGrants: Array.isArray(configuredGrants) ? new Set(configuredGrants) : null
  });
}
