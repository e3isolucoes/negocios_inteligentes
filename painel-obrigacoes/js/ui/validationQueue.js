// js/ui/validationQueue.js
// ---------------------------------------------------------------------------
// Aba "Validações". Duas visões:
//   • Para validar   — o que espera a aprovação de quem está logado
//   • Devolvidas     — o que voltou para o usuário corrigir e reenviar
//
// A Gestão (admin) enxerga as duas completas; o membro vê apenas o que lhe diz
// respeito, porque as views respeitam a RLS.
// ---------------------------------------------------------------------------
import {
  fetchPendingValidations, fetchRejected, fetchMySubmissions,
  approve, reject, resubmit,
  countPendingValidations, countRejected,
} from '../api/validation.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../dateUtils.js';
import { STATE } from '../state.js';

let container = null;
let visao = 'pendentes';          // 'pendentes' | 'devolvidas' | 'enviadas'
let pendentes = [];               // esperando MINHA validação
let devolvidas = [];              // rejeitadas, para eu corrigir
let enviadas = [];                // que EU enviei e aguardam validação de outro
let carregando = false;

export function validationBadgeCount() {
  return (pendentes.length || STATE.validation?.pending || 0)
    + (devolvidas.length || STATE.validation?.rejected || 0);
}

// --- Utilidades -------------------------------------------------------------
function dataBR(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

function esperaTexto(dias) {
  if (dias === null || dias === undefined) return '';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

// Fila parada é o risco desta funcionalidade: destaca o que passou do tempo.
function esperaClasse(dias) {
  if (dias >= 5) return 'espera-critica';
  if (dias >= 2) return 'espera-atencao';
  return '';
}

// --- Ciclo de vida ----------------------------------------------------------
export async function renderValidationQueue(el) {
  container = el;
  container.innerHTML = '<p class="loading">Carregando validações…</p>';
  await refresh();
}

async function refresh() {
  if (carregando) return;
  carregando = true;
  try {
    [pendentes, devolvidas, enviadas] = await Promise.all([
      fetchPendingValidations(),
      fetchRejected(),
      fetchMySubmissions(),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Não foi possível carregar: ${escapeHtml(err.message)}</p>`;
    carregando = false;
    return;
  }
  carregando = false;
  paint();
  atualizarSeloAba();
}

// --- Desenho ----------------------------------------------------------------
function paint() {
  const listas = { pendentes, devolvidas, enviadas };
  const cartoes = { pendentes: cartaoPendente, devolvidas: cartaoDevolvido, enviadas: cartaoEnviado };
  const lista = listas[visao] || [];

  container.innerHTML = `
    <div class="val-abas">
      <button class="val-aba ${visao === 'pendentes' ? 'ativa' : ''}" data-visao="pendentes">
        Para validar${pendentes.length ? ` <span class="val-cont">${pendentes.length}</span>` : ''}
      </button>
      <button class="val-aba ${visao === 'devolvidas' ? 'ativa' : ''}" data-visao="devolvidas">
        Devolvidas${devolvidas.length ? ` <span class="val-cont val-cont-erro">${devolvidas.length}</span>` : ''}
      </button>
      <button class="val-aba ${visao === 'enviadas' ? 'ativa' : ''}" data-visao="enviadas">
        Meus envios${enviadas.length ? ` <span class="val-cont val-cont-neutro">${enviadas.length}</span>` : ''}
      </button>
      <button class="btn-ghost val-atualizar" data-acao="atualizar" title="Atualizar">↻</button>
    </div>
    <div class="val-lista">
      ${lista.length === 0 ? vazio() : lista.map(cartoes[visao]).join('')}
    </div>`;

  container.querySelectorAll('[data-visao]').forEach(b =>
    b.addEventListener('click', () => { visao = b.dataset.visao; paint(); }));
  container.querySelector('[data-acao="atualizar"]')
    ?.addEventListener('click', () => refresh());

  container.querySelectorAll('[data-aprovar]').forEach(b =>
    b.addEventListener('click', () => aprovar(b.dataset.aprovar, b)));
  container.querySelectorAll('[data-rejeitar]').forEach(b =>
    b.addEventListener('click', () => abrirRejeicao(b.dataset.rejeitar)));
  container.querySelectorAll('[data-reenviar]').forEach(b =>
    b.addEventListener('click', () => reenviar(b.dataset.reenviar, b)));
}

function vazio() {
  const textos = {
    pendentes: ['Nada esperando sua validação.',
      'Quando alguém concluir uma tarefa que você valida, ela aparece aqui.'],
    devolvidas: ['Nenhuma tarefa devolvida.',
      'O que for rejeitado na validação aparece aqui para você corrigir.'],
    enviadas: ['Nenhum envio aguardando validação.',
      'As tarefas que você concluir e que exigem validação aparecem aqui até serem aprovadas.'],
  };
  const [titulo, texto] = textos[visao] || textos.pendentes;
  return `<div class="val-vazio"><p><strong>${titulo}</strong></p><p>${texto}</p></div>`;
}

// Só acompanhamento: quem enviou não age aqui, espera o validador.
function cartaoEnviado(v) {
  return `
    <article class="val-cartao val-enviado ${esperaClasse(v.dias_esperando)}">
      <header class="val-cabecalho">
        <div>
          <h4>${escapeHtml(v.obrigacao)}</h4>
          <p class="val-meta">${v.empresa ? escapeHtml(v.empresa) + ' · ' : ''}${dataBR(v.occurrence_date)}</p>
        </div>
        <span class="val-espera ${esperaClasse(v.dias_esperando)}">${esperaTexto(v.dias_esperando)}</span>
      </header>
      <p class="val-aguardando">
        Aguardando validação de <strong>${escapeHtml(v.aguardando_validacao_de || 'validador designado')}</strong>.
      </p>
    </article>`;
}

function cartaoPendente(v) {
  const cor = v.categoria_cor || '#64748b';
  return `
    <article class="val-cartao ${esperaClasse(v.dias_esperando)}" style="border-left-color:${escapeHtml(cor)}">
      <header class="val-cabecalho">
        <div>
          <h4>${escapeHtml(v.obrigacao)}</h4>
          <p class="val-meta">
            ${v.empresa ? escapeHtml(v.empresa) + ' · ' : ''}
            ${v.categoria ? `<span class="val-selo" style="background:${escapeHtml(cor)}">${escapeHtml(v.categoria)}</span>` : ''}
          </p>
        </div>
        <span class="val-espera ${esperaClasse(v.dias_esperando)}">${esperaTexto(v.dias_esperando)}</span>
      </header>

      <dl class="val-dados">
        <div><dt>Competência</dt><dd>${dataBR(v.occurrence_date)}</dd></div>
        <div><dt>Executado por</dt><dd>${escapeHtml(v.done_by_name || '—')}</dd></div>
        <div><dt>Enviado em</dt><dd>${dataBR(v.submitted_at)}</dd></div>
      </dl>

      <footer class="val-acoes">
        <button class="btn-ghost btn-danger" data-rejeitar="${v.completion_id}">Devolver para correção</button>
        <button class="btn-primary" data-aprovar="${v.completion_id}">Aprovar</button>
      </footer>
    </article>`;
}

function cartaoDevolvido(v) {
  return `
    <article class="val-cartao val-devolvido">
      <header class="val-cabecalho">
        <div>
          <h4>${escapeHtml(v.obrigacao)}</h4>
          <p class="val-meta">${v.empresa ? escapeHtml(v.empresa) + ' · ' : ''}${dataBR(v.occurrence_date)}</p>
        </div>
      </header>

      <div class="val-motivo">
        <strong>O que precisa ser corrigido</strong>
        <p>${escapeHtml(v.motivo || '—')}</p>
        <small>Devolvido por ${escapeHtml(v.rejeitado_por || '—')} em ${dataBR(v.rejeitado_em)}</small>
      </div>

      <footer class="val-acoes">
        <button class="btn-primary" data-reenviar="${v.completion_id}">Corrigi — reenviar para validação</button>
      </footer>
    </article>`;
}

// --- Ações ------------------------------------------------------------------
async function aprovar(id, botao) {
  botao.disabled = true;
  botao.textContent = 'Aprovando…';
  try {
    await approve(id);
    showToast('Tarefa aprovada e concluída.');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    botao.disabled = false;
    botao.textContent = 'Aprovar';
  }
}

async function reenviar(id, botao) {
  botao.disabled = true;
  botao.textContent = 'Reenviando…';
  try {
    await resubmit(id);
    showToast('Reenviado. Aguardando nova validação.');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    botao.disabled = false;
    botao.textContent = 'Corrigi — reenviar para validação';
  }
}

function abrirRejeicao(id) {
  const item = pendentes.find(p => p.completion_id === id);

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal">
      <h3>Devolver para correção</h3>
      <p class="hint">
        ${escapeHtml(item?.obrigacao || '')}${item?.done_by_name ? ` — executado por ${escapeHtml(item.done_by_name)}` : ''}
      </p>
      <div class="field">
        <label>O que precisa ser corrigido</label>
        <textarea id="valMotivo" rows="4" maxlength="500"
          placeholder="Seja específico: quem recebe precisa saber exatamente o que refazer."></textarea>
        <small class="contador"><span id="valContador">0</span>/500 · mínimo 10 caracteres</small>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" data-acao="cancelar">Cancelar</button>
        <button class="btn-primary btn-danger" data-acao="confirmar" disabled>Devolver</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const campo = back.querySelector('#valMotivo');
  const contador = back.querySelector('#valContador');
  const confirmar = back.querySelector('[data-acao="confirmar"]');

  campo.addEventListener('input', () => {
    const n = campo.value.trim().length;
    contador.textContent = campo.value.length;
    confirmar.disabled = n < 10;
  });
  campo.focus();

  const fechar = () => back.remove();
  back.querySelector('[data-acao="cancelar"]').addEventListener('click', fechar);
  back.addEventListener('click', e => { if (e.target === back) fechar(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });

  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    confirmar.textContent = 'Devolvendo…';
    try {
      await reject(id, campo.value);
      fechar();
      showToast('Devolvido ao responsável com o motivo informado.');
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
      confirmar.disabled = false;
      confirmar.textContent = 'Devolver';
    }
  });
}

// --- Selo na aba ------------------------------------------------------------
// Sem o contador visível, a fila cresce sem ninguém perceber e a validação
// vira o gargalo. Chame atualizarSeloAba() no boot e após cada conclusão.
export async function atualizarSeloAba() {
  const alvo = document.querySelector('[data-tab="validacoes"]');
  if (!alvo) return 0;

  const [aValidar, devolvidasN] = await Promise.all([
    countPendingValidations(),
    countRejected(),
  ]);
  const total = aValidar + devolvidasN;

  let selo = alvo.querySelector('.tab-badge');
  if (total === 0) {
    selo?.remove();
    return 0;
  }
  if (!selo) {
    selo = document.createElement('span');
    selo.className = 'tab-badge';
    alvo.appendChild(selo);
  }
  selo.textContent = total;
  selo.classList.toggle('tab-badge-erro', devolvidasN > 0);
  selo.title = devolvidasN > 0
    ? `${aValidar} para validar, ${devolvidasN} devolvida(s) para você corrigir`
    : `${aValidar} aguardando sua validação`;
  return total;
}
