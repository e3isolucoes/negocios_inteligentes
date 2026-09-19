import {
  STATE, isAdmin, isManager, isSuperUser, hasAdministrationAccess, canAccessModule, activeOccurrences,
  competenceForOccurrence, competenceKey, competenceLabel,
} from '../state.js';
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

function selectFilterHtml({ action, key, allLabel, options, selected }) {
  const value = selected || 'all';
  const dataKey = action === 'module-filter' ? '' : ` data-filter="${escapeHtml(key)}"`;
  return `<select class="dd-btn filter-select" data-action="${action}"${dataKey} aria-label="${escapeHtml(allLabel)}">`
    + `<option value="all" ${value === 'all' ? 'selected' : ''}>${escapeHtml(allLabel)}</option>`
    + options.map((option) => `<option value="${escapeHtml(option.value)}" ${value === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')
    + '</select>';
}

function competenceOptions() {
  const byId = new Map(STATE.obligations.map((ob) => [ob.id, ob]));
  const periods = new Map();

  activeOccurrences().forEach(({ competence }) => {
    const key = competenceKey(competence);
    if (key) periods.set(key, competenceLabel(competence));
  });

  STATE.completions.forEach((completion) => {
    const obligation = byId.get(completion.obligation_id);
    if (!obligation) return;
    const competence = competenceForOccurrence(obligation, completion.occurrence_date);
    const key = competenceKey(competence);
    if (key) periods.set(key, competenceLabel(competence));
  });

  return Array.from(periods.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([value, label]) => ({ value, label }));
}

function navIcon(name) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-5v-6h-5v6h-5A1.5 1.5 0 0 1 3 19.5z"/></svg>',
    obligations: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M8 11h8M8 15h5"/></svg>',
    validation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="m8 12 2.2 2.2L16 8.5"/></svg>',
    reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
    mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    system: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>',
  };
  return icons[name] || icons.home;
}

export function renderSidebarNavigation() {
  const valCount = validationBadgeCount();
  const mineCount = STATE.obligations.filter((o) => o.responsible_id === STATE.session?.id).length;
  const item = (view, label, icon, badge = '') => '<button type="button" class="side-nav-item ' + (STATE.view === view ? 'active' : '') + '" data-action="tab" data-tab="' + view + '"' + (STATE.view === view ? ' aria-current="page"' : '') + '>'
    + '<span class="side-nav-icon">' + navIcon(icon) + '</span>'
    + '<span class="side-nav-label">' + label + '</span>'
    + (badge ? '<span class="side-nav-badge">' + badge + '</span>' : '')
    + '</button>';

  let html = '<nav class="side-nav" aria-label="Navegação principal">';
  if (isManager() && hasModuleGrant(STATE.profile, 'dashboard')) html += item('dashboard', 'Início', 'home');
  if (hasModuleGrant(STATE.profile, 'obrigacoes')) html += item('board', 'Obrigações', 'obligations');
  if (!isManager() && hasModuleGrant(STATE.profile, 'obrigacoes')) html += item('mine', 'Minhas atividades', 'mine', mineCount || '');
  if (showValidationTab() && hasModuleGrant(STATE.profile, 'validacoes')) html += item('validacoes', 'Validações', 'validation', valCount || '');
  if (isManager() && hasModuleGrant(STATE.profile, 'relatorios')) html += item('reports', 'Relatórios', 'reports');
  if (hasAdministrationAccess() && hasModuleGrant(STATE.profile, 'administracao')) html += item('manage', 'Administração', 'admin');
  if (isSuperUser()) html += item('system-admin', 'Sistema', 'system');
  html += '</nav>';
  return html;
}

export function renderToolbar() {
  const resp = distinctResponsibles();
  const empresaOptions = STATE.companies.map((c) => ({ value: c.id, label: c.name }));
  const valCount = validationBadgeCount();
  const statusOptions = [
    { value: 'red', label: 'Atrasadas' },
    { value: 'today', label: 'Vence hoje' },
    { value: 'amber', label: 'Vencem em breve' },
    { value: 'green', label: 'No prazo' },
    { value: 'muted', label: 'Sem pendência próxima' },
  ];
  const receiptOptions = [{ value: 'missing', label: 'Sem comprovante' }];
  const moduleOptions = ADMINISTRATIVE_MODULES
    .filter((module) => canAccessModule(module.key))
    .map((module) => ({ value: module.key, label: module.label }));
  const periodOptions = competenceOptions();

  const activeFilterCount = Object.values(STATE.filters)
    .filter((value) => (value ?? 'all') !== 'all').length
    + (STATE.activeModule !== 'all' ? 1 : 0);
  let html = '<section class="toolbar workspace-filters" aria-label="Filtros da visualização">';
  html += '<div class="toolbar-heading"><div><span class="toolbar-eyebrow">Refine a visualização</span><strong>Filtros e ações</strong></div>';
  if (hasModuleGrant(STATE.profile, 'obrigacoes')) html += '<button class="btn-primary toolbar-new" data-action="new">+ Nova atividade</button>';
  html += '</div>';
  html += '<div class="filters"><span class="filters-label">Filtrar</span>';
  if (hasModuleGrant(STATE.profile, 'obrigacoes')) {
    html += selectFilterHtml({
      action: 'module-filter', key: 'module', allLabel: 'Todos os módulos', options: moduleOptions, selected: STATE.activeModule,
    });
  }
  html += ddHtml('empresa', 'Todas as empresas', empresaOptions, STATE.filters.empresa || 'all');
  html += ddHtml('category', 'Categorias de obrigação', CATEGORIES.map((c) => ({ value: c.key, label: c.label })), STATE.filters.category || 'all');
  html += ddHtml('responsible', 'Todos os responsáveis', resp.map((r) => ({ value: r, label: r })), STATE.filters.responsible || 'all');
  html += ddHtml('status', 'Todos os status', statusOptions, STATE.filters.status || 'all');
  html += ddHtml('receipt', 'Com ou sem comprovante', receiptOptions, STATE.filters.receipt || 'all');
  html += selectFilterHtml({
    action: 'filter-select', key: 'competence', allLabel: 'Todas as competências', options: periodOptions, selected: STATE.filters.competence || 'all',
  });
  html += `<button type="button" class="clear-filters" data-action="clear-filters" aria-label="Remover todos os filtros" ${activeFilterCount ? '' : 'disabled'}>Remover filtros${activeFilterCount ? ` <span>${activeFilterCount}</span>` : ''}</button>`;
  html += '</div></section>';
  return html;
}
