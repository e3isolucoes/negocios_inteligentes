import { STATE, isAdmin, isManager, isSuperUser, canAccessModule } from '../state.js';
import { CATEGORIES, ADMINISTRATIVE_MODULES } from '../constants.js';
import { escapeHtml } from '../dateUtils.js';
import { validationBadgeCount } from './validationQueue.js';
import { hasModuleGrant } from '../modules/registry.js';

function distinctResponsibles() {
  const set = new Set();
  STATE.obligations.forEach((o) => { if (o.responsible) set.add(o.responsible); });
  return Array.from(set).sort();
}

function showValidationTab() {
  if (isAdmin()) return true;
  if (validationBadgeCount() > 0) return true;
  return STATE.obligations.some((o) => o.validator_id && o.validator_id === STATE.session?.id);
}

function ddHtml(key, allLabel, options, selected) {
  let selLabel = allLabel;
  if (selected !== 'all') {
    const found = options.find((o) => o.value === selected);
    if (found) selLabel = found.label;
  }
  const items = `<button type="button" class="dd-item ${selected === 'all' ? 'active' : ''}" data-action="dd-select" data-dd="${key}" data-value="all" role="option" aria-selected="${selected === 'all'}">${escapeHtml(allLabel)}</button>`
    + options.map((o) => `<button type="button" class="dd-item ${selected === o.value ? 'active' : ''}" data-action="dd-select" data-dd="${key}" data-value="${escapeHtml(o.value)}" role="option" aria-selected="${selected === o.value}">${escapeHtml(o.label)}</button>`).join('');
  return `<div class="dd" data-dd-root="${key}">`
    + `<button type="button" class="dd-btn" data-action="dd-toggle" data-dd="${key}" aria-haspopup="listbox" aria-expanded="false"><span class="dd-label">${escapeHtml(selLabel)}</span><span class="dd-caret" aria-hidden="true">▾</span></button>`
    + `<div class="dd-panel hidden" data-dd-panel="${key}" role="listbox" aria-label="${escapeHtml(allLabel)}">${items}</div>`
    + '</div>';
}

export function renderToolbar() {
  const resp = distinctResponsibles();
  const empresaOptions = STATE.companies.map((c) => ({ value: c.id, label: c.name }));
  const mineCount = STATE.obligations.filter((o) => o.responsible_id === STATE.session?.id).length;
  const valCount = validationBadgeCount();
  const statusOptions = [
    { value: 'red', label: 'Atrasadas' },
    { value: 'today', label: 'Vence hoje' },
    { value: 'amber', label: 'Vencem em breve' },
    { value: 'green', label: 'No prazo' },
    { value: 'muted', label: 'Sem pendência próxima' },
  ];
  const receiptOptions = [{ value: 'missing', label: 'Sem comprovante' }];

  const activeFilterCount = Object.values(STATE.filters).filter((value) => value !== 'all').length;
  const tab = (view, label) => `<button class="tab-btn ${STATE.view === view ? 'active' : ''}" data-action="tab" data-tab="${view}"${STATE.view === view ? ' aria-current="page"' : ''}>${label}</button>`;

  let html = '<section class="toolbar" aria-label="Navegação e filtros">';
  html += '<nav class="tabs" aria-label="Áreas do painel">';
  if (hasModuleGrant(STATE.profile, 'obrigacoes')) {
    html += tab('board', 'Atividades');
    const modules = ADMINISTRATIVE_MODULES.filter((module) => canAccessModule(module.key));
    html += `<div class="module-tabs" aria-label="Módulos administrativos">${modules.map((module) => `<button type="button" class="module-tab ${STATE.activeModule === module.key ? 'active' : ''}" style="--module-color:${escapeHtml(module.color)}" data-action="module" data-module="${module.key}">${escapeHtml(module.label)}</button>`).join('')}</div>`;
    if (!isManager()) html += tab('mine', `Minhas atividades${mineCount ? ` (${mineCount})` : ''}`);
  }

  if (showValidationTab() && hasModuleGrant(STATE.profile, 'validacoes')) {
    const selo = valCount
      ? ` <span class="tab-badge${STATE.validation?.rejected ? ' tab-badge-erro' : ''}">${valCount}</span>`
      : '';
    html += tab('validacoes', `Validações${selo}`);
  }

  if (isManager()) {
    if (hasModuleGrant(STATE.profile, 'administracao')) html += tab('manage', 'Gerenciar');
    if (hasModuleGrant(STATE.profile, 'relatorios')) html += tab('reports', 'Relatórios');
    if (hasModuleGrant(STATE.profile, 'dashboard')) html += tab('dashboard', 'Central de Gestão');
  }
  if (isSuperUser()) html += tab('system-admin', 'Administração do sistema');
  html += '</nav>';

  html += `<div class="filters"><span class="filters-label">Filtrar</span>`;
  html += ddHtml('empresa', 'Todas as empresas', empresaOptions, STATE.filters.empresa);
  html += ddHtml('category', 'Categorias de obrigação', CATEGORIES.map((c) => ({ value: c.key, label: c.label })), STATE.filters.category);
  html += ddHtml('responsible', 'Todos os responsáveis', resp.map((r) => ({ value: r, label: r })), STATE.filters.responsible);
  html += ddHtml('status', 'Todos os status', statusOptions, STATE.filters.status);
  html += ddHtml('receipt', 'Com ou sem comprovante', receiptOptions, STATE.filters.receipt || 'all');
  if (activeFilterCount) {
    html += `<button type="button" class="clear-filters" data-action="clear-filters" aria-label="Limpar ${activeFilterCount} filtro(s) ativo(s)">Limpar filtros <span>${activeFilterCount}</span></button>`;
  }
  if (hasModuleGrant(STATE.profile, 'obrigacoes')) html += '<button class="btn-primary" data-action="new">+ Nova atividade</button>';
  html += '</div></section>';
  return html;
}
