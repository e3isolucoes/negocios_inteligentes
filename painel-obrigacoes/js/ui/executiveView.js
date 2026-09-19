import { filtrarObrigacoesPorCategoria } from '../dashboardHelpers.js';

const VISOES = Object.freeze([
  { id: 'Geral', label: 'Gestão Geral' },
  { id: 'Fiscal', label: 'Visão Fiscal' },
  { id: 'Contábil', label: 'Visão Contábil' },
  { id: 'Controladoria', label: 'Visão Controladoria' },
]);

let visaoAtiva = VISOES[0].id;

/**
 * Atualiza a aba ativa. O estado fica encapsulado neste componente e sobrevive
 * às renderizações da aplicação de página única.
 *
 * @param {string} visao
 */
export function selecionarVisaoExecutiva(visao) {
  if (VISOES.some(({ id }) => id === visao)) visaoAtiva = visao;
}

/**
 * Contêiner da Visão Executiva.
 *
 * @param {readonly object[]} obrigacoes dados brutos ou ocorrências enriquecidas
 * @param {(obrigacoesFiltradas: object[]) => string} renderDashboardArea
 * @returns {string}
 */
export function renderExecutiveView(obrigacoes, renderDashboardArea) {
  // A visão geral inclui categorias antigas, fiscais e as novas frentes
  // administrativas; as demais abas continuam oferecendo os recortes já
  // conhecidos por quem utilizava o painel anteriormente.
  const obrigacoesFiltradas = visaoAtiva === 'Geral'
    ? [...obrigacoes]
    : filtrarObrigacoesPorCategoria(obrigacoes, visaoAtiva);
  const tabs = VISOES.map(({ id, label }) => {
    const ativa = id === visaoAtiva;
    return `<button class="executive-tab${ativa ? ' is-active' : ''}" type="button" role="tab" aria-selected="${ativa}" aria-controls="executive-dashboard-area" tabindex="${ativa ? '0' : '-1'}" data-action="executive-view" data-view="${id}">${label}</button>`;
  }).join('');

  return '<div class="executive-view">'
    + '<header class="executive-view-header">'
      + '<div><span class="dashboard-eyebrow">CENTRAL DE GESTÃO</span><h2>Visão Executiva</h2><p>Acompanhe atividades, riscos, prazos e desempenho de toda a empresa.</p></div>'
      + `<nav class="executive-tabs" role="tablist" aria-label="Áreas da visão executiva">${tabs}</nav>`
    + '</header>'
    + `<div id="executive-dashboard-area" class="executive-dashboard-area" role="tabpanel">${renderDashboardArea(obrigacoesFiltradas)}</div>`
  + '</div>';
}
