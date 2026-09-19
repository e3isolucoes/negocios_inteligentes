// js/api/categorias.js
// ---------------------------------------------------------------------------
// CRUD de categorias para a aba Admin. A escrita é restrita a admin pela RLS;
// aqui só traduzimos as mensagens do banco para algo que a equipe entenda.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';

// Sob RLS, uma escrita barrada volta como zero linhas SEM erro. Se a tela não
// checar isso, o usuário acha que salvou.
function exigirLinha(data, error, acaoNegada) {
  if (error) throw new Error(traduzir(error.message));
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error(acaoNegada);
  }
  return Array.isArray(data) ? data[0] : data;
}

function traduzir(msg = '') {
  if (msg.includes('ux_categories_chave')) {
    return 'Já existe uma categoria com esse nome (a comparação ignora acento e maiúsculas).';
  }
  if (msg.includes('categories_cor_check')) {
    return 'Cor inválida. Use o formato #RRGGBB, por exemplo #2563eb.';
  }
  if (msg.includes('row-level security')) {
    return 'Somente administradores podem alterar categorias.';
  }
  return msg;
}

/** Lista para o combo de obrigações. Por padrão só as ativas. */
export async function listarCategorias({ incluirInativas = false } = {}) {
  let q = supabase.from('categories')
    .select('id, name, descricao, cor, ordem, ativo, sistema')
    .order('ordem').order('name');
  if (!incluirInativas) q = q.eq('ativo', true);

  const { data, error } = await q;
  if (error) throw new Error(traduzir(error.message));
  return data;
}

/** Lista para a tela Admin, com a contagem de obrigações de cada uma. */
export async function listarCategoriasComUso() {
  const { data, error } = await supabase.from('vw_categorias_uso').select('*');
  if (error) throw new Error(traduzir(error.message));
  return data;
}

export async function criarCategoria({ name, descricao = null, cor = '#64748b', ordem = 100 }) {
  const { data, error } = await supabase.from('categories')
    .insert(withCurrentWorkspace({ name, descricao, cor, ordem })).select();
  return exigirLinha(data, error, 'Somente administradores podem criar categorias.');
}

/** Renomear propaga sozinho para todas as obrigações vinculadas. */
export async function atualizarCategoria(id, campos) {
  const permitidos = ['name', 'descricao', 'cor', 'ordem', 'ativo'];
  const limpo = Object.fromEntries(
    Object.entries(campos).filter(([k]) => permitidos.includes(k)),
  );
  if (Object.keys(limpo).length === 0) throw new Error('Nada para atualizar.');

  const { data, error } = await supabase.from('categories')
    .update(limpo).eq('id', id).select();
  return exigirLinha(data, error, 'Somente administradores podem alterar categorias.');
}

/** Desativar é quase sempre melhor que excluir: preserva o histórico. */
export async function desativarCategoria(id) {
  return atualizarCategoria(id, { ativo: false });
}

export async function reativarCategoria(id) {
  return atualizarCategoria(id, { ativo: true });
}

/** Move todas as obrigações de uma categoria para outra. Retorna a quantidade. */
export async function reclassificar(origemId, destinoId) {
  const { data, error } = await supabase.rpc('categoria_reclassificar', {
    p_origem_id: origemId,
    p_destino_id: destinoId,
  });
  if (error) throw new Error(traduzir(error.message));
  return data;
}

/**
 * Exclusão definitiva. O banco recusa se a categoria for de sistema ou
 * estiver em uso — a mensagem devolvida já explica o motivo.
 */
export async function excluirCategoria(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(traduzir(error.message));
}

/** Salva a nova ordem depois de arrastar os itens na tela. */
export async function reordenar(idsNaOrdem) {
  const atualizacoes = idsNaOrdem.map((id, i) =>
    supabase.from('categories').update({ ordem: (i + 1) * 10 }).eq('id', id).select());
  const resultados = await Promise.all(atualizacoes);
  const falha = resultados.find(r => r.error);
  if (falha) throw new Error(traduzir(falha.error.message));
  if (resultados.some(r => !r.data?.length)) {
    throw new Error('Somente administradores podem reordenar categorias.');
  }
}
