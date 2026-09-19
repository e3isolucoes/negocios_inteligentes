// js/ui/validationAdmin.js
// ---------------------------------------------------------------------------
// Sub-aba "Validação" da área Admin. Três blocos:
//   1. Alertas — obrigações que exigem validação e estão sem validador
//   2. Configuração por categoria — define uma vez, vale para toda a categoria
//   3. Desempenho — fila e tempo médio por validador
// ---------------------------------------------------------------------------
import {
  fetchMissingValidators, fetchValidationPerformance, setCategoryValidator,
} from '../api/validation.js';
import { fetchCategoriesUsage } from '../api/categories.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../dateUtils.js';

let container = null;
let equipe = [];
let categorias = [];
let semValidador = [];
let desempenho = [];

/**
 * @param {HTMLElement} el
 * @param {Array} profiles  equipe: [{ id, display_name, email, role }]
 */
export async function renderValidationAdmin(el, profiles = []) {
  container = el;
  equipe = profiles;
  container.innerHTML = '<p class="loading">Carregando…</p>';
  await refresh();
}

async function refresh() {
  try {
    [categorias, semValidador, desempenho] = await Promise.all([
      fetchCategoriesUsage(),
      fetchMissingValidators(),
      fetchValidationPerformance(),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Não foi possível carregar: ${escapeHtml(err.message)}</p>`;
    return;
  }
  paint();
}

function opcoesEquipe(selecionado) {
  return equipe
    .slice()
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR'))
    .map(p => `<option value="${p.id}" ${p.id === selecionado ? 'selected' : ''}>`
      + `${escapeHtml(p.display_name || p.email)}${p.role === 'admin' ? ' (Gestão)' : ''}</option>`)
    .join('');
}

function paint() {
  container.innerHTML = `
    ${blocoAlerta()}

    <div class="admin-header"><h3>Validação por categoria</h3></div>
    <p class="hint">
      Defina aqui e vale para toda a categoria. Cada obrigação ainda pode ter um
      validador próprio, que tem prioridade sobre este.
    </p>
    <table class="admin-table">
      <thead><tr>
        <th>Categoria</th><th>Exige validação</th><th>Validador padrão</th>
        <th class="num">Obrigações</th><th></th>
      </tr></thead>
      <tbody>
        ${categorias.map(linhaCategoria).join('')
          || '<tr><td colspan="5">Nenhuma categoria cadastrada.</td></tr>'}
      </tbody>
    </table>

    <div class="admin-header"><h3>Desempenho da validação</h3></div>
    ${blocoDesempenho()}`;

  container.querySelectorAll('tbody tr[data-cat]').forEach(tr => {
    tr.querySelector('[data-acao="salvar"]')
      ?.addEventListener('click', () => salvar(tr));
  });
}

function blocoAlerta() {
  if (semValidador.length === 0) return '';
  return `
    <div class="alerta alerta-erro">
      <strong>${semValidador.length} obrigação(ões) exigem validação e estão sem validador.</strong>
      <p>Enquanto isso não for resolvido, a equipe não consegue concluí-las.</p>
      <ul>
        ${semValidador.slice(0, 10).map(o =>
          `<li>${escapeHtml(o.obrigacao)}${o.empresa ? ` — ${escapeHtml(o.empresa)}` : ''}</li>`).join('')}
        ${semValidador.length > 10 ? `<li>…e mais ${semValidador.length - 10}</li>` : ''}
      </ul>
    </div>`;
}

function linhaCategoria(c) {
  return `
    <tr data-cat="${c.id}">
      <td>
        <span class="cat-dot" style="background:${escapeHtml(c.cor || '#64748b')}"></span>
        ${escapeHtml(c.rotulo || c.name)}
      </td>
      <td>
        <label class="check-inline">
          <input type="checkbox" data-campo="exigir" ${c.exige_validacao ? 'checked' : ''} />
        </label>
      </td>
      <td>
        <select data-campo="validador">
          <option value="">— nenhum —</option>
          ${opcoesEquipe(c.validador_padrao_id)}
        </select>
      </td>
      <td class="num">${c.obrigacoes}</td>
      <td>
        <label class="check-inline aplicar">
          <input type="checkbox" data-campo="aplicar" />
          <span title="Marca as obrigações que já existem nesta categoria">aplicar às existentes</span>
        </label>
        <button class="btn-ghost" data-acao="salvar">Salvar</button>
      </td>
    </tr>`;
}

function blocoDesempenho() {
  if (desempenho.length === 0) {
    return '<p class="hint">Nenhuma validação registrada ainda.</p>';
  }
  return `
    <table class="admin-table">
      <thead><tr>
        <th>Validador</th><th class="num">Na fila</th><th class="num">Aprovadas</th>
        <th class="num">Devolvidas</th><th class="num">Tempo médio</th><th class="num">Maior espera</th>
      </tr></thead>
      <tbody>
        ${desempenho.map(d => `
          <tr class="${d.maior_espera_dias >= 5 ? 'linha-alerta' : ''}">
            <td>${escapeHtml(d.validador || '—')}</td>
            <td class="num">${d.na_fila}</td>
            <td class="num">${d.aprovadas}</td>
            <td class="num">${d.rejeitadas}</td>
            <td class="num">${d.horas_media !== null && d.horas_media !== undefined ? `${d.horas_media} h` : '—'}</td>
            <td class="num">${d.maior_espera_dias !== null && d.maior_espera_dias !== undefined ? `${d.maior_espera_dias} d` : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="hint">
      Fila parada é o risco desta funcionalidade: se o tempo médio subir, a
      validação virou o gargalo em vez do controle.
    </p>`;
}

async function salvar(tr) {
  const id = tr.dataset.cat;
  const exigir = tr.querySelector('[data-campo="exigir"]').checked;
  const validador = tr.querySelector('[data-campo="validador"]').value || null;
  const aplicar = tr.querySelector('[data-campo="aplicar"]').checked;
  const botao = tr.querySelector('[data-acao="salvar"]');

  if (exigir && !validador) {
    showToast('Escolha quem valida antes de exigir validação nesta categoria.', 'error');
    return;
  }

  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try {
    const afetadas = await setCategoryValidator(id, validador, {
      require: exigir, applyToExisting: aplicar,
    });
    showToast(aplicar
      ? `Configuração salva. ${afetadas} obrigação(ões) atualizada(s).`
      : 'Configuração salva. Vale para as obrigações novas desta categoria.');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
    botao.disabled = false;
    botao.textContent = 'Salvar';
  }
}
