import { STATE, hasAdministrationAccess } from '../state.js';
import { renderObligationsManage } from './manageObligations.js';
import { renderCompaniesManage } from './manageCompanies.js';
import { renderTeamManage } from './manageTeam.js';
import { renderImportManage } from './manageImport.js';
import { renderAuditManage } from './manageAudit.js';
import { renderHolidaysManage } from './manageHolidays.js';
import { renderRulesManage } from './manageRules.js';
import { renderRegimesManage } from './manageRegimes.js';
import { renderCategoriesAdmin } from './categoriesAdmin.js';
import { renderValidationAdmin } from './validationAdmin.js';

function subTabsHtml() {
  const tabs = [
    ['obligations', 'Atividades'],
    ['companies', 'Empresas'],
    ['team', 'Equipe e acessos'],
    ['import', 'Importar planilha'],
    ['rules', 'Regras'],
    ['regimes', 'Regimes tributários'],
    ['categories', 'Categorias'],
    ['validation', 'Validação'],
    ['holidays', 'Feriados'],
    ['audit', 'Histórico'],
  ];
  return '<div class="mgmt-subtabs">' + tabs.map(([key, label]) => (
    `<button class="tab-btn ${STATE.manageSection === key ? 'active' : ''}" data-action="manage-tab" data-section="${key}">${label}</button>`
  )).join('') + '</div>';
}

export function renderManage() {
  if (!hasAdministrationAccess()) {
    return '<div class="empty">Esta área é restrita ao Admin da Ferramenta e às pessoas autorizadas por ele.</div>';
  }

  let body;
  if (STATE.manageSection === 'companies') {
    body = renderCompaniesManage();
  } else if (STATE.manageSection === 'team') {
    body = renderTeamManage();
  } else if (STATE.manageSection === 'import') {
    body = renderImportManage();
  } else if (STATE.manageSection === 'rules') {
    body = renderRulesManage();
  } else if (STATE.manageSection === 'regimes') {
    body = renderRegimesManage();
  } else if (STATE.manageSection === 'categories' || STATE.manageSection === 'validation') {
    body = '<div id="manageAsync"><p class="loading">Carregando…</p></div>';
  } else if (STATE.manageSection === 'holidays') {
    body = renderHolidaysManage();
  } else if (STATE.manageSection === 'audit') {
    body = renderAuditManage();
  } else {
    body = renderObligationsManage();
  }

  return subTabsHtml() + '<div class="mgmt-section">' + body + '</div>';
}

export async function hydrateManageSection() {
  if (STATE.manageSection === 'categories') {
    const el = document.getElementById('manageAsync');
    if (el) await renderCategoriesAdmin(el);
  } else if (STATE.manageSection === 'validation') {
    const el = document.getElementById('manageAsync');
    if (el) await renderValidationAdmin(el, STATE.profiles.filter((p) => p.active !== false));
  }
}
