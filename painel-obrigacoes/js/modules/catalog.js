import { ModuleRegistry, moduleContext } from './registry.js';
import { STATE, isManager, isSuperUser } from '../state.js';
import { renderBoard } from '../ui/board.js';
import { renderManage, hydrateManageSection } from '../ui/manage.js';
import { renderReports } from '../ui/reports.js';
import { renderDashboard } from '../ui/dashboard.js';
import { renderValidationQueue } from '../ui/validationQueue.js';
import { renderSystemAdmin } from '../ui/systemAdmin.js';

const enabledModules = globalThis.E3I_CONFIG?.enabledModules;

export const moduleRegistry = new ModuleRegistry({ enabledModules })
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
    || moduleRegistry.get('access-denied', context);
}
