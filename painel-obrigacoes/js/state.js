// Estado em memória da aplicação. Não usamos localStorage/sessionStorage —
// a fonte de verdade é sempre o Supabase; este objeto só guarda o que já
// foi carregado nesta sessão do navegador, para renderizar rápido.
import { getActiveOccurrence, statusOf, fmtKey } from './dateUtils.js';

export const STATE = {
  view: 'board', // 'board' | 'mine' | 'manage' | 'system-admin'
  activeModule: 'all',
  manageSection: 'obligations', // 'obligations' | 'companies' | 'team' | 'import' | 'rules' (dentro da aba Gerenciar)
  filters: {
    empresa: 'all', category: 'all', responsible: 'all', status: 'all', receipt: 'all',
  },
  editingId: null,
  editingCompanyId: null,
  editingRuleId: null,

  session: null, // { id, email }
  profile: null, // { id, email, display_name, role }

  obligations: [],
  companies: [],
  completions: [], // linhas cruas da tabela completions
  profiles: [], // equipe (todas as contas), visível a partir da aba Gerenciar → Equipe
  workspaces: [], // contas de clientes, visíveis exclusivamente ao superusuário

  auditLog: null, // carregado sob demanda ao abrir Gerenciar → Histórico
  holidays: [], // feriados cadastrados, usados no ajuste "próximo dia útil"
  obligationRules: [], // catálogo de obrigações-padrão (mercado), gerenciado pela gerência
  occurrenceOverrides: [], // exceções pontuais de data (prorrogação), por ocorrência
  taxRegimes: [], // catálogo de regimes tributários (Simples, Presumido, Real, MEI...)
  taxRegimeRules: [], // vínculo M:N regime <-> obligation_rules ({tax_regime_id, obligation_rule_id})
  checklistItems: [], // todos os itens de checklist de todas as obrigações, com estado "completed" ao vivo
  validation: { pending: 0, rejected: 0 },

  importPreview: null, // { fileName, rows: [...] } — resultado da validação do CSV, antes de confirmar
  pendingNewUserCredentials: null, // { email, password } — mostrado uma vez logo após criar uma conta

  loading: false,
  connectionError: null,
};

export function isAdmin() {
  return ['super_admin', 'admin'].includes(STATE.profile?.role) && STATE.profile?.active !== false;
}

export function isSuperUser() {
  return STATE.profile?.role === 'super_admin' && STATE.profile?.active !== false;
}

// Gestores mantêm a operação sem receber o poder reservado ao administrador
// de criar contas, trocar papéis ou revogar acessos.
export function isManager() {
  return ['super_admin', 'admin', 'gestor'].includes(STATE.profile?.role) && STATE.profile?.active !== false;
}

// A visibilidade da carteira é uma permissão própria: não deve depender da
// aba em que a pessoa estava quando seu papel foi alterado. Mantê-la separada
// das permissões de edição evita reintroduzir o recorte por responsável para
// o Gestor quando novas funções operacionais forem adicionadas.
export function canViewAllObligations() {
  return isManager();
}

export function canAccessModule(moduleKey) {
  if (isAdmin() || STATE.profile?.module_access == null) return true;
  return Array.isArray(STATE.profile.module_access) && STATE.profile.module_access.includes(moduleKey);
}

// Mapa obligation_id -> Set(occurrence_date "YYYY-MM-DD") para consultas
// rápidas de "essa ocorrência já foi concluída?".
export function completionsIndex() {
  const map = new Map();
  for (const c of STATE.completions) {
    // Uma devolução reabre a ocorrência para correção. Envios aguardando
    // validação permanecem bloqueados para impedir um segundo envio.
    if (c.status === 'rejeitada') continue;
    if (!map.has(c.obligation_id)) map.set(c.obligation_id, new Set());
    map.get(c.obligation_id).add(c.occurrence_date);
  }
  return map;
}

export function companyName(companyId) {
  return STATE.companies.find((c) => c.id === companyId)?.name || '';
}

export function holidaysDateSet() {
  return new Set(STATE.holidays.map((h) => h.holiday_date));
}

export function lastCompletion(obligationId) {
  const mine = STATE.completions
    .filter((c) => c.obligation_id === obligationId)
    .sort((a, b) => b.occurrence_date.localeCompare(a.occurrence_date) || b.done_at.localeCompare(a.done_at));
  return mine[0] || null;
}

// Exceção de data cadastrada para uma ocorrência específica (identificada
// pela data que a regra de recorrência teria calculado sozinha), se houver.
export function overrideForOccurrence(obligationId, rawDateKey) {
  return STATE.occurrenceOverrides.find(
    (o) => o.obligation_id === obligationId && o.original_date === rawDateKey,
  ) || null;
}

// Ocorrência ativa (próxima pendência) e status de cada obrigação, na
// janela padrão de dateUtils.js. Compartilhado entre o Painel e a Visão
// Executiva para não recalcular a mesma coisa de duas formas diferentes.
//
// `active` é sempre a data CRUA calculada pela regra de recorrência — é
// essa data que identifica a ocorrência (chave de conclusão, de checklist
// etc.) e nunca muda por causa de um ajuste pontual. `displayDate` é a
// data EFETIVA depois de aplicar uma eventual exceção (ver
// obligation_date_overrides) — é essa que deve aparecer na tela e que
// define o status (atrasada/vence em breve/no prazo).
// Regras do catálogo (obligation_rules) vinculadas a um regime tributário.
export function rulesForRegime(regimeId) {
  const ruleIds = new Set(
    STATE.taxRegimeRules.filter((l) => l.tax_regime_id === regimeId).map((l) => l.obligation_rule_id),
  );
  return STATE.obligationRules.filter((r) => ruleIds.has(r.id));
}

export function taxRegimeName(regimeId) {
  return STATE.taxRegimes.find((r) => r.id === regimeId)?.name || '';
}

// Progresso do checklist AO VIVO de uma obrigação (estado persistido em
// checklist_items.completed, não a última conclusão registrada). Retorna
// null se a obrigação não tem checklist cadastrado.
export function checklistProgress(obligationId) {
  const items = STATE.checklistItems
    .filter((i) => i.obligation_id === obligationId)
    .sort((a, b) => a.position - b.position);
  if (!items.length) return null;
  const checked = items.filter((i) => i.completed).length;
  return {
    items, total: items.length, checked, pct: Math.round((checked / items.length) * 100),
  };
}

export function activeOccurrences() {
  const idx = completionsIndex();
  const holidaysSet = holidaysDateSet();
  return STATE.obligations.map((ob) => {
    const active = getActiveOccurrence(ob, idx, holidaysSet);
    const override = active ? overrideForOccurrence(ob.id, fmtKey(active)) : null;
    const displayDate = override ? new Date(`${override.override_date}T00:00:00`) : active;
    const status = statusOf(displayDate);
    return {
      ob, active, displayDate, override, status,
    };
  });
}
