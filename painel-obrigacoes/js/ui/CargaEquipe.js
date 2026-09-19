const STATUS_ENCERRADOS = new Set([
  'cancelada',
  'cancelado',
  'completed',
  'concluida',
  'concluido',
  'done',
  'encerrada',
  'encerrado',
  'entregue',
]);

function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function escaparHtml(valor) {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function estaAtiva(ocorrencia) {
  if (!ocorrencia || ocorrencia.active === false || ocorrencia.ativa === false) return false;
  const status = normalizar(ocorrencia.status?.label ?? ocorrencia.status);
  return !STATUS_ENCERRADOS.has(status);
}

/**
 * Consolida ocorrências ativas por responsável e identifica sobrecarga.
 * A sobrecarga exige volume 50% acima da média dos demais e diferença mínima
 * de duas tarefas, evitando alertas ruidosos em carteiras muito pequenas.
 *
 * @param {readonly Record<string, unknown>[]} ocorrencias
 */
export function analisarCargaEquipe(ocorrencias = []) {
  if (!Array.isArray(ocorrencias)) return [];

  const totais = new Map();
  ocorrencias.filter(estaAtiva).forEach((ocorrencia) => {
    const dados = ocorrencia.ob ?? ocorrencia.obrigacao ?? ocorrencia;
    const nome = String(
      dados.responsavel ?? dados.responsible ?? ocorrencia.responsavel ?? ocorrencia.responsible ?? 'Sem responsável',
    ).trim() || 'Sem responsável';
    totais.set(nome, (totais.get(nome) ?? 0) + 1);
  });

  const totalGeral = [...totais.values()].reduce((total, valor) => total + valor, 0);
  const cargas = [...totais].map(([responsavel, quantidade]) => {
    const quantidadeDemais = totais.size - 1;
    const mediaDemais = quantidadeDemais
      ? (totalGeral - quantidade) / quantidadeDemais
      : quantidade;
    return {
      responsavel,
      quantidade,
      mediaDemais,
      sobrecarregado: quantidadeDemais > 0
        && quantidade >= mediaDemais * 1.5
        && quantidade - mediaDemais >= 2,
    };
  });

  return cargas.sort((a, b) => b.quantidade - a.quantidade
    || a.responsavel.localeCompare(b.responsavel, 'pt-BR'));
}

function estilos() {
  return `
    .carga-equipe{background:#fff;border:1px solid #dce3e1;border-radius:14px;box-shadow:0 8px 24px rgba(22,48,60,.08);color:#16303c;font-family:Inter,system-ui,sans-serif;padding:20px}
    .carga-equipe__cabecalho{align-items:flex-start;display:flex;gap:20px;justify-content:space-between;margin-bottom:18px}
    .carga-equipe__rotulo{color:#477f82;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    .carga-equipe h2{font-size:18px;margin:4px 0 0}.carga-equipe__total{color:#657477;font-size:12px;white-space:nowrap}
    .carga-equipe__lista{display:grid;gap:14px}.carga-equipe__item{display:grid;gap:7px}
    .carga-equipe__linha{align-items:center;display:flex;gap:10px;justify-content:space-between}
    .carga-equipe__nome{font-size:13px;font-weight:700}.carga-equipe__quantidade{color:#657477;font-size:12px}
    .carga-equipe__trilha{background:#edf1f0;border-radius:999px;height:10px;overflow:hidden}
    .carga-equipe__barra{background:#477f82;border-radius:inherit;display:block;height:100%;min-width:3px;transition:width .25s ease}
    .carga-equipe__item--alerta .carga-equipe__nome,.carga-equipe__item--alerta .carga-equipe__quantidade{color:#a33b32}
    .carga-equipe__item--alerta .carga-equipe__barra{background:#c95248}
    .carga-equipe__alerta{background:#fff0ee;border-radius:999px;color:#a33b32;font-size:10px;font-weight:800;padding:4px 7px;text-transform:uppercase}
    .carga-equipe__vazio{color:#657477;font-size:13px;margin:0;padding:18px 0;text-align:center}
    @media(prefers-reduced-motion:reduce){.carga-equipe__barra{transition:none}}
  `;
}

/**
 * Renderiza a distribuição proporcional das ocorrências ativas da equipe.
 *
 * @param {readonly Record<string, unknown>[]} ocorrencias
 * @returns {HTMLElement}
 * @example document.querySelector('#dashboard').append(CargaEquipe(ocorrencias));
 */
export default function CargaEquipe(ocorrencias = []) {
  const cargas = analisarCargaEquipe(ocorrencias);
  const maiorCarga = cargas[0]?.quantidade ?? 0;
  const total = cargas.reduce((soma, carga) => soma + carga.quantidade, 0);
  const componente = document.createElement('section');
  componente.className = 'carga-equipe';
  componente.setAttribute('aria-labelledby', 'carga-equipe-titulo');
  componente.innerHTML = `
    <style>${estilos()}</style>
    <header class="carga-equipe__cabecalho">
      <div><span class="carga-equipe__rotulo">Capacidade operacional</span><h2 id="carga-equipe-titulo">Carga da equipe</h2></div>
      <span class="carga-equipe__total">${total} tarefa${total === 1 ? '' : 's'} em aberto</span>
    </header>
    ${cargas.length ? `<div class="carga-equipe__lista">${cargas.map((carga) => {
    const percentual = Math.round((carga.quantidade / maiorCarga) * 100);
    const nome = escaparHtml(carga.responsavel);
    return `<div class="carga-equipe__item${carga.sobrecarregado ? ' carga-equipe__item--alerta' : ''}">
        <div class="carga-equipe__linha"><span class="carga-equipe__nome">${nome}</span><span class="carga-equipe__quantidade">${carga.quantidade} tarefa${carga.quantidade === 1 ? '' : 's'}${carga.sobrecarregado ? ' <span class="carga-equipe__alerta">Acima da média</span>' : ''}</span></div>
        <div class="carga-equipe__trilha" role="progressbar" aria-label="${nome}: ${carga.quantidade} tarefas em aberto" aria-valuemin="0" aria-valuemax="${maiorCarga}" aria-valuenow="${carga.quantidade}"><span class="carga-equipe__barra" style="width:${percentual}%"></span></div>
      </div>`;
  }).join('')}</div>` : '<p class="carga-equipe__vazio">Nenhuma tarefa em aberto.</p>'}
  `;
  return componente;
}
