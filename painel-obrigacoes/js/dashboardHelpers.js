/**
 * @typedef {Object} Obrigacao
 * @property {string|number} id
 * @property {string} titulo
 * @property {string} empresa
 * @property {string} responsavel
 * @property {string} frequencia
 * @property {string} data_vencimento
 * @property {string} status
 * @property {string} categoria
 */

/** @typedef {'Fiscal'|'Contábil'|'Controladoria'} GrupoCategoria */
/** @typedef {'Atrasadas'|'Vencem em breve'|'No prazo'} StatusExecutivo */
/** @typedef {Obrigacao & {tags: string[]}} ObrigacaoComTags */
/** @typedef {Record<StatusExecutivo, number>} ContagemPorStatus */

/** @type {Readonly<Record<GrupoCategoria, ReadonlySet<string>>>} */
const CATEGORIAS_POR_GRUPO = Object.freeze({
  Fiscal: new Set(['Federal', 'Estadual', 'Municipal', 'federal', 'estadual', 'municipal']),
  Contábil: new Set(['Contábil', 'Societária', 'contabil', 'societaria']),
  Controladoria: new Set(['Controladoria', 'Financeiro', 'controladoria', 'financeiro']),
});

const TAG_PATTERN = /#[\p{L}\p{N}_-]+/gu;

/**
 * Filtra obrigações pelas categorias pertencentes ao grupo executivo informado.
 *
 * @param {readonly Obrigacao[]} obrigacoes
 * @param {GrupoCategoria} grupo
 * @returns {Obrigacao[]}
 */
export function filtrarObrigacoesPorCategoria(obrigacoes, grupo) {
  const categorias = CATEGORIAS_POR_GRUPO[grupo];
  if (!categorias) return [];
  return obrigacoes.filter((obrigacao) => {
    // O dashboard trabalha com ocorrências enriquecidas (`{ ob, status, ... }`),
    // enquanto consumidores externos podem enviar a obrigação bruta. Aceitar os
    // dois formatos mantém o filtro como a única regra de segmentação da tela.
    const categoria = obrigacao.categoria
      ?? obrigacao.category
      ?? obrigacao.ob?.categoria
      ?? obrigacao.ob?.category;
    return categorias.has(categoria);
  });
}

/**
 * Extrai hashtags do título sem alterar a obrigação original.
 *
 * @param {Obrigacao} obrigacao
 * @returns {ObrigacaoComTags}
 */
export function extrairTagsDaObrigacao(obrigacao) {
  const tags = obrigacao.titulo.match(TAG_PATTERN) ?? [];
  const titulo = obrigacao.titulo
    .replace(TAG_PATTERN, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { ...obrigacao, titulo, tags };
}

/**
 * Conta obrigações em cada status exibido no Dashboard Executivo.
 *
 * @param {readonly Obrigacao[]} obrigacoes
 * @returns {ContagemPorStatus}
 */
export function contarObrigacoesPorStatus(obrigacoes) {
  /** @type {ContagemPorStatus} */
  const contagem = {
    Atrasadas: 0,
    'Vencem em breve': 0,
    'No prazo': 0,
  };

  obrigacoes.forEach(({ status }) => {
    if (Object.hasOwn(contagem, status)) {
      contagem[/** @type {StatusExecutivo} */ (status)] += 1;
    }
  });

  return contagem;
}
