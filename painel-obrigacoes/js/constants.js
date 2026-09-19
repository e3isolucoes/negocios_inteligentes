// js/constants.js
// ---------------------------------------------------------------------------
// Constantes de domínio. As categorias deixaram de ser fixas: a lista abaixo é
// apenas a reserva usada enquanto o banco não responde. No boot, applyCategories()
// substitui o conteúdo pelo cadastro real (tabela `categories`).
// ---------------------------------------------------------------------------

// ATENÇÃO: o array é sempre alterado NO LUGAR, nunca reatribuído. Todos os
// módulos que já importaram CATEGORIES continuam apontando para o mesmo array
// e enxergam a lista nova sem precisar reimportar.
export const CATEGORIES = [
  { key: 'federal', label: 'Federal', color: '#2563eb' },
  { key: 'estadual', label: 'Estadual', color: '#0891b2' },
  { key: 'municipal', label: 'Municipal', color: '#0d9488' },
  { key: 'trabalhista', label: 'Trabalhista/Previdenciária', color: '#ca8a04' },
  { key: 'societaria', label: 'Societária', color: '#9333ea' },
  { key: 'administrativo', label: 'Administrativo', color: '#475569' },
  { key: 'financeiro', label: 'Financeiro', color: '#047857' },
  { key: 'pessoas', label: 'Pessoas e RH', color: '#be185d' },
  { key: 'comercial', label: 'Comercial', color: '#c2410c' },
  { key: 'operacoes', label: 'Operações', color: '#0369a1' },
  { key: 'compras', label: 'Compras e fornecedores', color: '#7c3aed' },
  { key: 'tecnologia', label: 'Tecnologia', color: '#0f766e' },
  { key: 'projetos', label: 'Projetos', color: '#a21caf' },
];

// Módulos são áreas organizacionais, independentes das categorias tributárias.
// CATEGORIES classifica exclusivamente obrigações acessórias.
export const ADMINISTRATIVE_MODULES = [
  { key: 'fiscal', label: 'Fiscal', color: '#2563eb' },
  { key: 'contabil', label: 'Contábil', color: '#0891b2' },
  { key: 'departamento_pessoal', label: 'Departamento Pessoal', color: '#ca8a04' },
  { key: 'recursos_humanos', label: 'Recursos Humanos', color: '#be185d' },
  { key: 'financeiro', label: 'Financeiro', color: '#047857' },
  { key: 'compras', label: 'Compras', color: '#7c3aed' },
  { key: 'vendas', label: 'Vendas', color: '#c2410c' },
  { key: 'administrativo', label: 'Administrativo', color: '#475569' },
];

export function moduleInfo(key) {
  return ADMINISTRATIVE_MODULES.find((module) => module.key === key)
    || { key: key || 'administrativo', label: key || 'Administrativo', color: '#64748b' };
}

export const FREQUENCIES = ['diaria', 'mensal', 'trimestral', 'anual', 'pontual'];

export const FREQ_LABELS = {
  diaria: 'Diária',
  mensal: 'Mensal',
  trimestral: 'Trimestral',
  anual: 'Anual',
  pontual: 'Pontual',
};

export const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const MONTH_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export const PRIORITIES = [
  { key: 'baixa', label: 'Baixa' },
  { key: 'media', label: 'Média' },
  { key: 'alta', label: 'Alta' },
  { key: 'critica', label: 'Crítica' },
];

export function priorityInfo(key) {
  return PRIORITIES.find((p) => p.key === key) || PRIORITIES[1];
}

// --- Tipos de contagem de dia e comportamento em dia útil ------------------
// Definidos aqui para que formulários e validações possam iterar sobre as
// opções disponíveis.
export const DAY_TYPES = [
  { key: 'fixo', label: 'Dia fixo do mês' },
  { key: 'util_do_mes', label: 'Nº dia útil do mês' },
];

export const BUSINESS_DAY_SHIFTS = [
  { key: 'nenhum', label: 'Nenhum' },
  { key: 'proximo_util', label: 'Empurra para próximo dia útil' },
  { key: 'anterior_util', label: 'Antecipar para dia útil anterior' },
];

// --- Categorias vindas do banco --------------------------------------------

/** Dados completos por chave (id, cor, ordem, validador padrão). */
export const CATEGORY_META = new Map();

/**
 * Substitui a lista de categorias pelo cadastro do banco.
 * Recebe as linhas de `vw_categorias_ativas`, no formato { key, label, color }.
 * Se vier vazio, mantém a reserva — melhor uma lista desatualizada que uma tela
 * sem nenhuma categoria.
 */
export function applyCategories(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;

  CATEGORIES.length = 0;
  CATEGORY_META.clear();

  for (const r of rows) {
    const item = {
      key: r.key,
      label: r.label || r.key,
      color: r.color || '#64748b',
    };
    CATEGORIES.push(item);
    CATEGORY_META.set(r.key, { ...r, ...item });
  }
  return true;
}

/**
 * Categoria pela chave. Nunca devolve indefinido: se a obrigação tiver uma
 * categoria que foi desativada, exibe a própria chave em cinza em vez de
 * quebrar a tela.
 */
export function catInfo(key) {
  const achou = CATEGORIES.find((c) => c.key === key);
  if (achou) return achou;
  if (key) return { key, label: key, color: '#94a3b8' };
  return CATEGORIES[0] || { key: '', label: '—', color: '#94a3b8' };
}

/** Cor da categoria, para selos e bordas. */
export function catColor(key) {
  return catInfo(key).color;
}
