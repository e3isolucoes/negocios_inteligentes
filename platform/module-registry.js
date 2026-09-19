/**
 * Registro central de módulos da E3I Negócios Inteligentes.
 *
 * O shell consome exclusivamente este catálogo. Novos produtos entram na
 * plataforma adicionando um registro aqui, sem hardcode no HTML.
 */
export const MODULE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'obrigacoes',
    name: 'Painel de Obrigações',
    shortName: 'Obrigações',
    description: 'Prazos, responsáveis, evidências e acompanhamento da operação.',
    icon: '✓',
    entrypoint: './painel-obrigacoes/index.html',
    status: 'active',
  }),
]);

export function getAvailableModules() {
  return MODULE_REGISTRY.filter((module) => module.status === 'active');
}

export function getModuleById(id) {
  return getAvailableModules().find((module) => module.id === id) || null;
}

export function getDefaultModule() {
  return getAvailableModules()[0] || null;
}
