import { ModuleRegistry, moduleContext } from './registry.js';
import { STATE, isManager, isSuperUser } from '../state.js';
import { renderBoard } from '../ui/board.js';
import { renderManage, hydrateManageSection } from '../ui/manage.js';
import { renderReports } from '../ui/reports.js';
import { renderDashboard } from '../ui/dashboard.js';
import { renderValidationQueue } from '../ui/validationQueue.js';
import { renderSystemAdmin } from '../ui/systemAdmin.js';

const enabledModules = globalThis.E3I_CONFIG?.enabledModules;

// A configuração de implantação usa identificadores funcionais (as mesmas
// chaves presentes em module_grants), enquanto o roteador trabalha com IDs de
// telas. Expandimos essas chaves aqui para que `obrigacoes`, por exemplo,
// habilite tanto o painel geral (`board`) quanto `mine`. O módulo de acesso
// restrito fica sempre disponível para garantir um fallback seguro.
const MODULE_VIEW_IDS = Object.freeze({
  obrigacoes: ['board', 'mine'],
  validacoes: ['validacoes'],
  dashboard: ['dashboard'],
  relatorios: ['reports'],
  administracao: ['manage'],
  plataforma: ['system-admin'],
});

export function expandEnabledViewIds(configuredModules) {
  if (!Array.isArray(configuredModules) || !configuredModules.length) return configuredModules;
  const viewIds = new Set(['access-denied']);
  configuredModules.forEach((moduleId) => {
    const mappedViews = MODULE_VIEW_IDS[moduleId] || [moduleId];
    mappedViews.forEach((viewId) => viewIds.add(viewId));
  });
  return [...viewIds];
}

export const moduleRegistry = new ModuleRegistry({ enabledModules: expandEnabledViewIds(enabledModules) })
  .register({ id: 'access-denied', label: 'Acesso restrito', order: 999,
    render: () => '<div class="empty" role="alert">Este módulo não está liberado para seu perfil. Solicite a concessão ao administrador da empresa.</div>' })
  .register({ id: 'board', label: 'Painel', order: 10, requiredGrant: 'obrigacoes', render: () => renderBoard() })
  .register({ id: 'mine', label: 'Minhas obrigações', order: 20, requiredGrant: 'obrigacoes', render: () => renderBoard({ onlyMine: true }) })
  .register({ id: 'validacoes', label: 'Validações', order: 30, requiredGrant: 'validacoes',
    render: () => '<div id="validationQueue"><p class="loading">Carregando validações…</p></div>',
    mount: () => { const target = document.getElementById('validationQueue'); if (target) renderValidationQueue(target); } })
  .register({ id: 'dashboard', label: 'Visão executiva', order: 40, requiredGrant: 'dashboard', canAccess: () => isManager(), render: () => renderDashboard() })
  .register({ id: 'reports', label: 'Relatórios', order: 50, requiredGrant: 'relatorios', canAccess: () => isManager(), render: () => renderReports() })
  .register({ id: 'manage', label: 'Administração', order: 60, requiredGrant: 'administracao', canAccess: () => isManager(), render: () => renderManage(), mount: () => hydrateManageSection() })
  .register({ id: 'system-admin', label: 'Plataforma', order: 70, canAccess: () => isSuperUser(), render: () => renderSystemAdmin() });

export function currentModuleContext() {
  return moduleContext({ state: STATE, permissions: { manager: isManager(), superUser: isSuperUser() } });
}

export function resolveView(viewId) {
  const context = currentModuleContext();
  return moduleRegistry.get(viewId, context)
    || moduleRegistry.get('board', context)
    || moduleRegistry.get('access-denied', context)
    || Object.freeze({
      id: 'access-denied',
      label: 'Acesso restrito',
      render: () => '<div class="empty" role="alert">Nenhuma área do painel está disponível para este perfil.</div>',
    });
}
