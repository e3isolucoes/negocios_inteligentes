// js/ui/categoriesAdmin.js
// ---------------------------------------------------------------------------
// Sub-aba "Categorias" da área Admin.
// Renderiza dentro de um container que você passa, no mesmo padrão das outras
// telas de admin. Depende de: api/categories.js, ui/toast.js, ui/confirmDialog.js
// e do escapeHtml de dateUtils.js.
// ---------------------------------------------------------------------------
import {
  fetchCategoriesUsage, createCategory, updateCategory,
  deleteCategory, reclassifyCategory, reorderCategories,
} from '../api/categories.js';
import { applyCategories } from '../constants.js';
import { fetchCategories } from '../api/categories.js';
import { showToast } from './toast.js';
import { confirmDialog } from './confirmDialog.js';
import { escapeHtml } from '../dateUtils.js';

let container = null;
let rows = [];

const CORES = [
  '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#ca8a04',
  '#dc2626', '#e11d48', '#9333ea', '#7c3aed', '#64748b',
];

export async function renderCategoriesAdmin(el) {
  container = el;
  container.innerHTML = '<p class="loading">Carregando categorias…</p>';
  await refresh();
}

async function refresh() {
  try {
    rows = await fetchCategoriesUsage();
  } catch (err) {
    container.innerHTML = `<p class="error">Não foi possível carregar: ${escapeHtml(err.message)}</p>`;
    return;
  }
  paint();
  // mantém o combo de obrigações em dia sem recarregar a página
  try { applyCategories(await fetchCategories()); } catch { /* combo atualiza no próximo boot */ }
}

function paint() {
  const linhas = rows.map((c, i) => `
    <tr data-id="${c.id}" class="${c.ativo ? '' : 'inativa'}">
      <td>
        <button class="btn-ghost btn-mini" data-action="subir"  ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
        <button class="btn-ghost btn-mini" data-action="descer" ${i === rows.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
      </td>
      <td><span class="cat-dot" style="background:${escapeHtml(c.cor || '#64748b')}"></span></td>
      <td>
        <strong>${escapeHtml(c.name)}</strong>
        ${c.sistema ? '<span class="tag">sistema</span>' : ''}
        ${c.ativo ? '' : '<span class="tag tag-off">desativada</span>'}
      </td>
      <td class="num">${c.obrigacoes}</td>
      <td class="acoes">
        <button class="btn-ghost" data-action="editar">Editar</button>
        <button class="btn-ghost" data-action="alternar">${c.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="btn-ghost btn-danger" data-action="excluir"
          ${c.sistema || c.obrigacoes > 0 ? 'disabled' : ''}
          title="${c.sistema ? 'Categoria de sistema' : c.obrigacoes > 0 ? 'Em uso por obrigações' : 'Excluir'}">
          Excluir
        </button>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <div class="admin-header">
      <h3>Categorias</h3>
      <button class="btn-primary" data-action="nova">Nova categoria</button>
    </div>
    <p class="hint">
      Renomear atualiza automaticamente todas as obrigações da categoria.
      Categorias em uso não podem ser excluídas — reclassifique ou desative.
    </p>
    <table class="admin-table">
      <thead><tr>
        <th>Ordem</th><th>Cor</th><th>Nome</th><th class="num">Obrigações</th><th>Ações</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="5">Nenhuma categoria cadastrada.</td></tr>'}</tbody>
    </table>`;

  container.querySelector('[data-action="nova"]')
    ?.addEventListener('click', () => abrirFormulario(null));

  container.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    const id = tr.dataset.id;
    const cat = rows.find(c => c.id === id);
    tr.querySelector('[data-action="editar"]')?.addEventListener('click', () => abrirFormulario(cat));
    tr.querySelector('[data-action="alternar"]')?.addEventListener('click', () => alternar(cat));
    tr.querySelector('[data-action="excluir"]')?.addEventListener('click', () => excluir(cat));
    tr.querySelector('[data-action="subir"]')?.addEventListener('click', () => mover(id, -1));
    tr.querySelector('[data-action="descer"]')?.addEventListener('click', () => mover(id, 1));
  });
}

function abrirFormulario(cat) {
  const editando = Boolean(cat);
  const cor = cat?.cor || CORES[rows.length % CORES.length];

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal">
      <h3>${editando ? 'Editar categoria' : 'Nova categoria'}</h3>
      <div class="field">
        <label>Nome</label>
        <input type="text" id="catNome" maxlength="60"
               value="${escapeHtml(cat?.name || '')}" placeholder="Ex.: Perícia Contábil" />
      </div>
      <div class="field">
        <label>Descrição (opcional)</label>
        <input type="text" id="catDesc" maxlength="200" value="${escapeHtml(cat?.descricao || '')}" />
      </div>
      <div class="field">
        <label>Cor</label>
        <div class="cores">
          ${CORES.map(c => `<button type="button" class="cor-opcao${c === cor ? ' ativa' : ''}"
             data-cor="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </div>
      </div>
      ${editando && cat.obrigacoes > 0
        ? `<p class="hint">Esta categoria tem ${cat.obrigacoes} obrigação(ões). Renomear atualiza todas elas.</p>`
        : ''}
      <div class="modal-actions">
        <button class="btn-ghost"  data-action="cancelar">Cancelar</button>
        <button class="btn-primary" data-action="salvar">Salvar</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  let corEscolhida = cor;
  back.querySelectorAll('.cor-opcao').forEach(b => b.addEventListener('click', () => {
    corEscolhida = b.dataset.cor;
    back.querySelectorAll('.cor-opcao').forEach(x => x.classList.toggle('ativa', x === b));
  }));

  const fechar = () => back.remove();
  back.querySelector('[data-action="cancelar"]').addEventListener('click', fechar);
  back.addEventListener('click', e => { if (e.target === back) fechar(); });

  back.querySelector('[data-action="salvar"]').addEventListener('click', async () => {
    const name = back.querySelector('#catNome').value.trim();
    const descricao = back.querySelector('#catDesc').value.trim() || null;
    if (!name) { showToast('Informe o nome da categoria.', 'error'); return; }

    try {
      if (editando) {
        await updateCategory(cat.id, { name, descricao, cor: corEscolhida });
        showToast(name !== cat.name
          ? `Categoria renomeada. ${cat.obrigacoes} obrigação(ões) atualizada(s).`
          : 'Categoria atualizada.');
      } else {
        await createCategory({ name, descricao, cor: corEscolhida, ordem: (rows.length + 1) * 10 });
        showToast('Categoria criada.');
      }
      fechar();
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function alternar(cat) {
  try {
    await updateCategory(cat.id, { ativo: !cat.ativo });
    showToast(cat.ativo
      ? 'Categoria desativada. As obrigações existentes continuam válidas.'
      : 'Categoria reativada.');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function excluir(cat) {
  if (cat.obrigacoes > 0) {
    await reclassificar(cat);
    return;
  }
  const ok = await confirmDialog({
    title: 'Excluir categoria',
    message: `Excluir "${cat.name}"? Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir',
  });
  if (!ok) return;
  try {
    await deleteCategory(cat.id);
    showToast('Categoria excluída.');
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reclassificar(cat) {
  const destinos = rows.filter(c => c.id !== cat.id && c.ativo);
  if (destinos.length === 0) {
    showToast('Não há outra categoria ativa para receber as obrigações.', 'error');
    return;
  }
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `
    <div class="modal">
      <h3>Reclassificar antes de excluir</h3>
      <p>"${escapeHtml(cat.name)}" tem ${cat.obrigacoes} obrigação(ões). Para onde movê-las?</p>
      <div class="field">
        <label>Nova categoria</label>
        <select id="catDestino">
          ${destinos.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost"  data-action="cancelar">Cancelar</button>
        <button class="btn-primary" data-action="mover">Mover e excluir</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const fechar = () => back.remove();
  back.querySelector('[data-action="cancelar"]').addEventListener('click', fechar);

  back.querySelector('[data-action="mover"]').addEventListener('click', async () => {
    try {
      const destinoId = back.querySelector('#catDestino').value;
      const qtd = await reclassifyCategory(cat.id, destinoId);
      await deleteCategory(cat.id);
      fechar();
      showToast(`${qtd} obrigação(ões) reclassificada(s). Categoria excluída.`);
      await refresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function mover(id, delta) {
  const i = rows.findIndex(c => c.id === id);
  const j = i + delta;
  if (j < 0 || j >= rows.length) return;
  const nova = [...rows];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  try {
    await reorderCategories(nova.map(c => c.id));
    await refresh();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
