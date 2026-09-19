import { escapeHtml } from '../dateUtils.js';

// Termos mantidos próximos ao componente para deixar explícito o que compõe
// o Fast Close e facilitar a evolução do escopo pelo time contábil.
const ESCOPO_FECHAMENTO = Object.freeze([
  'conciliacao bancaria',
  'fechamento contabil mensal',
  'conciliacao de contas patrimoniais',
]);

function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

function tituloDa(item) {
  return item?.titulo ?? item?.name ?? item?.ob?.titulo ?? item?.ob?.name ?? '';
}

function statusDa(item) {
  return item?.status?.label ?? item?.status ?? item?.situacao ?? '';
}

function fazParteDoFechamento(item) {
  const titulo = normalizar(tituloDa(item));
  return ESCOPO_FECHAMENTO.some((termo) => titulo.includes(termo));
}

function possuiComprovante(item) {
  const origem = item?.ob ?? item ?? {};
  return Boolean(
    item?.comprovante
    || item?.attachment_path
    || item?.comprovante_url
    || origem.comprovante
    || origem.attachment_path
    || origem.comprovante_url,
  );
}

function estaConcluida(item) {
  const status = normalizar(statusDa(item));
  return status.startsWith('sem pendencia')
    || status === 'concluida'
    || status === 'concluido'
    || item?.status?.tone === 'muted'
    || possuiComprovante(item);
}

function requerAcompanhamento(item) {
  const status = normalizar(statusDa(item));
  return status === 'no prazo'
    || status === 'vence em breve'
    || status === 'vencem em breve';
}

/**
 * Renderiza a régua de Fast Close a partir das obrigações do mês.
 * Aceita tanto obrigações brutas quanto ocorrências enriquecidas (`{ ob, status }`).
 *
 * @param {readonly object[]} obrigacoes
 * @returns {string}
 */
export function ReguaFechamento(obrigacoes = []) {
  const tarefas = obrigacoes.filter(fazParteDoFechamento);
  const concluidas = tarefas.filter(estaConcluida).length;
  const percentual = tarefas.length ? Math.round((concluidas / tarefas.length) * 100) : 0;
  const tom = percentual < 50 ? 'red' : percentual <= 80 ? 'amber' : 'green';
  const pendentes = tarefas.filter((item) => !estaConcluida(item) && requerAcompanhamento(item));

  const lista = pendentes.length
    ? `<ul class="close-ruler-list">${pendentes.map((item) => `<li><span>${escapeHtml(tituloDa(item))}</span><small class="tone-${item?.status?.tone === 'amber' || normalizar(statusDa(item)).includes('breve') ? 'amber' : 'green'}">${escapeHtml(statusDa(item))}</small></li>`).join('')}</ul>`
    : '<p class="close-ruler-empty">Nenhuma tarefa no prazo ou vencendo em breve requer acompanhamento.</p>';

  return '<section class="dashboard-section close-ruler" aria-labelledby="close-ruler-title">'
    + '<div class="close-ruler-heading"><div><span class="dashboard-eyebrow">FAST CLOSE · FECHAMENTO MENSAL</span><h2 id="close-ruler-title">Régua de fechamento</h2></div>'
    + `<div class="close-ruler-score tone-${tom}"><strong>${percentual}%</strong><span>${concluidas} de ${tarefas.length} concluída(s)</span></div></div>`
    + `<div class="close-ruler-track tone-${tom}" role="progressbar" aria-label="Progresso do fechamento mensal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentual}"><span style="width:${percentual}%"></span></div>`
    + '<div class="close-ruler-footer"><span>Pendências no horizonte</span>' + lista + '</div>'
    + '</section>';
}

