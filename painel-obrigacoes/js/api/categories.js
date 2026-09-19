// js/api/categories.js
// ---------------------------------------------------------------------------
// CRUD de categorias. A escrita é restrita a admin pela RLS; aqui traduzimos
// as mensagens do banco para algo que a equipe entenda.
// ---------------------------------------------------------------------------
import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

// Sob RLS, uma escrita barrada volta como zero linhas SEM erro. Se a tela não
// checar isso, o usuário acha que salvou.
function requireRow(data, error, deniedMessage) {
  if (error) throw new Error(translate(error.message));
  if (!data || (Array.isArray(data) && data.length === 0)) throw new Error(deniedMessage);
  return Array.isArray(data) ? data[0] : data;
}

function translate(msg = '') {
  if (msg.includes('ux_categories_chave')) {
    return 'Já existe uma categoria com esse nome (a comparação ignora acento e maiúsculas).';
  }
  if (msg.includes('categories_cor_check')) {
    return 'Cor inválida. Use o formato #RRGGBB, por exemplo #2563eb.';
  }
  if (msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'Somente administradores podem alterar categorias.';
  }
  return msg;
}

/** Lista para o combo de obrigações. Por padrão só as ativas. */
export async function fetchCategories({ includeInactive = false } = {}) {
  if (isAwsDataBackend()) return (await awsData.list('categories'))
    .filter((category) => includeInactive || category.ativo !== false)
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || (a.name || '').localeCompare(b.name || '', 'pt-BR'))
    .map((category) => ({ ...category, key: category.name, label: category.name, color: category.cor }));
  let q = supabase.from('categories')
    .select('id, name, descricao, cor, ordem, ativo, sistema')
    .order('ordem').order('name');
  if (!includeInactive) q = q.eq('ativo', true);

  const { data, error } = await q;
  if (error) throw new Error(translate(error.message));
  return (data || []).map((c) => ({
    ...c, key: c.name, label: c.name, color: c.cor,
  }));
}

/** Lista da tela Admin, com a contagem de obrigações de cada categoria. */
export async function fetchCategoriesUsage() {
  if (isAwsDataBackend()) {
    const [categories, obligations] = await Promise.all([awsData.list('categories'), awsData.list('obligations')]);
    return categories.map((category) => ({ ...category, total_obligations: obligations.filter((item) => item.category === category.name).length }));
  }
  const { data, error } = await supabase.from('vw_categorias_uso').select('*');
  if (error) throw new Error(translate(error.message));
  return data || [];
}

export async function createCategory({ name, descricao = null, cor = '#64748b', ordem = 100 }) {
  if (isAwsDataBackend()) return awsData.create('categories', { name, descricao, cor, ordem, ativo: true });
  const { data, error } = await supabase.from('categories')
    .insert(withCurrentWorkspace({ name, descricao, cor, ordem })).select();
  return requireRow(data, error, 'Somente administradores podem criar categorias.');
}

/** Renomear propaga sozinho para todas as obrigações vinculadas. */
export async function updateCategory(id, fields) {
  const allowed = ['name', 'descricao', 'cor', 'ordem', 'ativo'];
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k)),
  );
  if (Object.keys(clean).length === 0) throw new Error('Nada para atualizar.');

  if (isAwsDataBackend()) return awsData.update('categories', id, clean);

  const { data, error } = await supabase.from('categories')
    .update(clean).eq('id', id).select();
  return requireRow(data, error, 'Somente administradores podem alterar categorias.');
}

/** Desativar é quase sempre melhor que excluir: preserva o histórico. */
export function deactivateCategory(id) { return updateCategory(id, { ativo: false }); }
export function reactivateCategory(id) { return updateCategory(id, { ativo: true }); }

/** Move todas as obrigações de uma categoria para outra. Retorna a quantidade. */
export async function reclassifyCategory(fromId, toId) {
  if (isAwsDataBackend()) throw new Error('Reclassificação em lote ainda não está habilitada no backend AWS.');
  const { data, error } = await supabase.rpc('categoria_reclassificar', {
    p_origem_id: fromId,
    p_destino_id: toId,
  });
  if (error) throw new Error(translate(error.message));
  return data;
}

/**
 * Exclusão definitiva. O banco recusa se a categoria for de sistema ou
 * estiver em uso — a mensagem devolvida já explica o motivo.
 */
export async function deleteCategory(id) {
  if (isAwsDataBackend()) return awsData.remove('categories', id);
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(translate(error.message));
}

/** Salva a nova ordem depois de mover os itens na tela. */
export async function reorderCategories(idsInOrder) {
  if (isAwsDataBackend()) {
    await Promise.all(idsInOrder.map((id, index) => awsData.update('categories', id, { ordem: (index + 1) * 10 })));
    return;
  }
  const results = await Promise.all(idsInOrder.map((id, i) =>
    supabase.from('categories').update({ ordem: (i + 1) * 10 }).eq('id', id).select()));
  const failed = results.find(r => r.error);
  if (failed) throw new Error(translate(failed.error.message));
  if (results.some(r => !r.data?.length)) {
    throw new Error('Somente administradores podem reordenar categorias.');
  }
}
