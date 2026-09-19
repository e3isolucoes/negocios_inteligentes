import { escapeHtml } from '../dateUtils.js';

const TERMOS_MONITORADOS = Object.freeze([
  'divergencia',
  'conciliacao',
  'auditoria',
  'margem',
]);

const STATUS_FINALIZADOS = new Set([
  'concluida',
  'concluido',
  'sem pendencia',
  'cancelada',
  'cancelado',
]);

function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function dadosDa(ocorrencia) {
  const obrigacao = ocorrencia?.ob ?? ocorrencia ?? {};
  return {
    titulo: obrigacao.titulo ?? obrigacao.title ?? obrigacao.name ?? 'Obrigação sem título',
    empresa: ocorrencia?.empresa?.nome
      ?? ocorrencia?.empresa
      ?? obrigacao.empresa?.nome
      ?? obrigacao.empresa
      ?? obrigacao.company_name
      ?? obrigacao.company
      ?? 'Empresa não informada',
    responsavel: obrigacao.responsavel
      ?? obrigacao.responsible
      ?? ocorrencia?.responsavel
      ?? 'Sem responsável',
    status: ocorrencia?.status?.label
      ?? ocorrencia?.status
      ?? obrigacao.status?.label
      ?? obrigacao.status
      ?? obrigacao.situacao
      ?? 'Pendente',
    tom: ocorrencia?.status?.tone ?? obrigacao.status?.tone,
    diasRestantes: ocorrencia?.status?.diffDays
      ?? ocorrencia?.diasRestantes
      ?? obrigacao.diasRestantes
      ?? obrigacao.days_remaining,
  };
}

/**
 * Seleciona ocorrências de auditoria e conciliação que ainda requerem atenção.
 * Aceita tanto ocorrências enriquecidas (`{ ob, status }`) quanto objetos planos.
 *
 * @param {readonly Record<string, any>[]} ocorrencias
 * @returns {Record<string, any>[]}
 */
export function filtrarDivergencias(ocorrencias = []) {
  if (!Array.isArray(ocorrencias)) return [];

  return ocorrencias.filter((ocorrencia) => {
    const dados = dadosDa(ocorrencia);
    const titulo = normalizar(dados.titulo);
    const status = normalizar(dados.status);
    const correspondeAoEscopo = TERMOS_MONITORADOS.some((termo) => titulo.includes(termo));
    const estaFinalizada = STATUS_FINALIZADOS.has(status) || dados.tom === 'muted';
    return correspondeAoEscopo && !estaFinalizada;
  });
}

function alertaDa(ocorrencia) {
  const { diasRestantes, status, tom } = dadosDa(ocorrencia);
  const dias = Number(diasRestantes);

  if (Number.isFinite(dias)) {
    if (dias < 0) return { texto: `${Math.abs(dias)} dia(s) em atraso`, classe: 'text-bg-danger' };
    if (dias === 0) return { texto: 'Vence hoje', classe: 'text-bg-danger' };
    if (dias === 1) return { texto: 'Vence amanhã', classe: 'text-bg-warning' };
    return { texto: `${dias} dias restantes`, classe: dias <= 7 ? 'text-bg-warning' : 'text-bg-info' };
  }

  const statusNormalizado = normalizar(status);
  const classe = tom === 'red' || statusNormalizado.includes('atras')
    ? 'text-bg-danger'
    : tom === 'amber' || statusNormalizado.includes('breve')
      ? 'text-bg-warning'
      : 'text-bg-secondary';
  return { texto: String(status), classe };
}

function carregarBootstrap() {
  if (document.querySelector('[data-painel-divergencias-bootstrap]')) return;
  const folhaDeEstilo = document.createElement('link');
  folhaDeEstilo.rel = 'stylesheet';
  folhaDeEstilo.href = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
  folhaDeEstilo.integrity = 'sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH';
  folhaDeEstilo.crossOrigin = 'anonymous';
  folhaDeEstilo.dataset.painelDivergenciasBootstrap = '';
  document.head.append(folhaDeEstilo);
}

/**
 * Cria um painel responsivo de obrigações de auditoria e conciliação.
 * O componente utiliza Bootstrap 5.3 e carrega sua folha de estilos uma única vez.
 *
 * @param {readonly Record<string, any>[]} ocorrencias Todas as ocorrências de obrigações.
 * @returns {HTMLElement}
 * @example document.querySelector('#dashboard').append(PainelDivergencias(ocorrencias));
 */
export default function PainelDivergencias(ocorrencias = []) {
  carregarBootstrap();
  const divergencias = filtrarDivergencias(ocorrencias);
  const painel = document.createElement('section');
  painel.className = 'container-fluid px-0 py-2';
  painel.setAttribute('aria-labelledby', 'painel-divergencias-titulo');

  const conteudo = divergencias.length
    ? `<div class="row g-2">${divergencias.map((ocorrencia) => {
      const dados = dadosDa(ocorrencia);
      const alerta = alertaDa(ocorrencia);
      return `
        <article class="col-12 col-md-6 col-xl-4">
          <div class="card h-100 border-0 shadow-sm">
            <div class="card-body p-3">
              <div class="d-flex align-items-start justify-content-between gap-2 mb-3">
                <h3 class="h6 fw-semibold mb-0">${escapeHtml(dados.titulo)}</h3>
                <span class="badge ${alerta.classe} flex-shrink-0">${escapeHtml(alerta.texto)}</span>
              </div>
              <dl class="row g-2 small mb-0">
                <div class="col-12"><dt class="text-body-secondary d-inline">Empresa:</dt> <dd class="d-inline mb-0">${escapeHtml(dados.empresa)}</dd></div>
                <div class="col-12"><dt class="text-body-secondary d-inline">Responsável:</dt> <dd class="d-inline mb-0">${escapeHtml(dados.responsavel)}</dd></div>
              </dl>
            </div>
          </div>
        </article>`;
    }).join('')}</div>`
    : '<div class="alert alert-success mb-0" role="status">Nenhuma divergência pendente ou próxima do vencimento.</div>';

  painel.innerHTML = `
    <header class="d-flex align-items-center justify-content-between gap-3 mb-3">
      <div><span class="text-uppercase text-body-secondary small fw-semibold">Auditoria e conciliação</span><h2 id="painel-divergencias-titulo" class="h5 mb-0">Painel de divergências</h2></div>
      <span class="badge rounded-pill text-bg-dark">${divergencias.length}</span>
    </header>
    ${conteudo}`;
  return painel;
}
