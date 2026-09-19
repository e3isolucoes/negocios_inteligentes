const TERMOS_CRITICOS = ['DARF COFINS', 'ICMS', 'DCTFWEB'];
const STATUS_DE_PERIGO = new Set(['VENCEM EM BREVE', 'ATRASADA', 'ATRASADAS']);
const CORES_DE_ALERTA = ['#dc2626', '#f97316', '#facc15', '#b91c1c', '#fb923c', '#eab308'];

function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Seleciona as obrigações fiscais que exigem ação imediata.
 *
 * @param {readonly Record<string, unknown>[]} obrigacoes
 * @returns {Record<string, unknown>[]}
 */
export function filtrarObrigacoesCriticas(obrigacoes = []) {
  if (!Array.isArray(obrigacoes)) return [];

  return obrigacoes.filter((obrigacao) => {
    const titulo = normalizar(obrigacao.titulo ?? obrigacao.title ?? obrigacao.name);
    const status = normalizar(obrigacao.status?.label ?? obrigacao.status);
    return TERMOS_CRITICOS.some((termo) => titulo.includes(termo))
      && STATUS_DE_PERIGO.has(status);
  });
}

function agruparPorResponsavel(obrigacoes) {
  const grupos = new Map();
  obrigacoes.forEach((obrigacao) => {
    const responsavel = String(
      obrigacao.responsavel ?? obrigacao.responsible ?? 'Sem responsável',
    ).trim() || 'Sem responsável';
    grupos.set(responsavel, (grupos.get(responsavel) ?? 0) + 1);
  });
  return [...grupos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
}

function estilos() {
  return `
    .termometro-risco { background:linear-gradient(145deg,#fff 0%,#fff7ed 100%); border:1px solid #fed7aa; border-radius:20px; box-shadow:0 12px 30px rgba(154,52,18,.08); color:#431407; font-family:Inter,system-ui,sans-serif; padding:24px; }
    .termometro-risco__cabecalho { align-items:flex-start; display:flex; gap:16px; justify-content:space-between; margin-bottom:20px; }
    .termometro-risco__rotulo { color:#c2410c; display:block; font-size:11px; font-weight:800; letter-spacing:.12em; margin-bottom:5px; text-transform:uppercase; }
    .termometro-risco h2 { font-size:20px; line-height:1.2; margin:0; }
    .termometro-risco__sinal { background:#fee2e2; border-radius:999px; color:#b91c1c; font-size:12px; font-weight:800; padding:7px 11px; white-space:nowrap; }
    .termometro-risco__grafico { height:260px; margin:auto; max-width:440px; position:relative; }
    .termometro-risco__centro { left:50%; pointer-events:none; position:absolute; text-align:center; top:50%; transform:translate(-50%,-50%); }
    .termometro-risco__centro strong { color:#991b1b; display:block; font-size:34px; line-height:1; }
    .termometro-risco__centro span { color:#78716c; display:block; font-size:11px; font-weight:700; line-height:1.2; margin-top:6px; max-width:90px; text-transform:uppercase; }
    .termometro-risco__vazio { align-items:center; color:#78716c; display:flex; height:220px; justify-content:center; text-align:center; }
    @media (max-width:480px) { .termometro-risco { padding:18px; } .termometro-risco__cabecalho { display:block; } .termometro-risco__sinal { display:inline-block; margin-top:12px; } }
  `;
}

/**
 * Cria um card com uma rosca Chart.js que distribui riscos fiscais por responsável.
 * O carregamento do Chart.js ocorre somente quando há dados para exibir.
 *
 * @param {readonly Record<string, unknown>[]} obrigacoes
 * @returns {HTMLElement}
 * @example document.querySelector('#dashboard').append(TermometroRisco(obrigacoes));
 */
export default function TermometroRisco(obrigacoes = []) {
  const criticas = filtrarObrigacoesCriticas(obrigacoes);
  const responsaveis = agruparPorResponsavel(criticas);
  const componente = document.createElement('section');
  componente.className = 'termometro-risco';
  componente.setAttribute('aria-label', 'Termômetro de risco fiscal');
  componente.innerHTML = `
    <style>${estilos()}</style>
    <header class="termometro-risco__cabecalho">
      <div><span class="termometro-risco__rotulo">Zona de perigo</span><h2>Termômetro de risco fiscal</h2></div>
      <span class="termometro-risco__sinal">Ação prioritária</span>
    </header>
    ${criticas.length ? `
      <div class="termometro-risco__grafico">
        <canvas aria-label="Distribuição de ${criticas.length} obrigações críticas por responsável" role="img"></canvas>
        <div class="termometro-risco__centro" aria-hidden="true"><strong>${criticas.length}</strong><span>críticas pendentes</span></div>
      </div>` : '<div class="termometro-risco__vazio">Nenhuma obrigação crítica na zona de perigo.</div>'}
  `;

  if (criticas.length) {
    const canvas = componente.querySelector('canvas');
    import('https://cdn.jsdelivr.net/npm/chart.js@4.4.9/+esm').then(({ Chart }) => {
      if (!canvas.isConnected) return;
      new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: responsaveis.map(([nome]) => nome),
          datasets: [{
            data: responsaveis.map(([, total]) => total),
            backgroundColor: responsaveis.map((_, indice) => CORES_DE_ALERTA[indice % CORES_DE_ALERTA.length]),
            borderColor: '#fff',
            borderWidth: 4,
            hoverOffset: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, usePointStyle: true } },
            tooltip: { callbacks: { label: ({ label, formattedValue }) => ` ${label}: ${formattedValue}` } },
          },
        },
      });
    });
  }

  return componente;
}
