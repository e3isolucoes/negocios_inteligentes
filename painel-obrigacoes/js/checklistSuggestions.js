import { getSankhyaChecklistSuggestions } from './obligationChecklistTemplates.js?v=20260908-csp-wasm-v2';
import { getAccessToken } from './api/auth.js';
import { STATE } from './state.js';

// Rota relativa da Azure Function gerenciada pela mesma Static Web App. O
// navegador envia apenas os dados operacionais; credenciais da OpenAI ficam nas
// configurações server-side do recurso Azure.
const CHECKLIST_SUGGESTIONS_API = '/api/checklist-suggestions';

const GENERIC_STEPS = {
  federal: ['Confirmar período de apuração e prazo oficial', 'Conferir dados cadastrais e procurações', 'Reconciliar valores com a contabilidade', 'Transmitir no portal oficial', 'Salvar recibo e comprovante de entrega'],
  estadual: ['Confirmar período de referência e prazo estadual', 'Conferir documentos fiscais de entrada e saída', 'Reconciliar apuração e eventuais créditos', 'Transmitir no portal da SEFAZ', 'Salvar recibo e comprovante de entrega'],
  municipal: ['Confirmar competência e prazo municipal', 'Conferir notas fiscais e retenções', 'Validar a apuração com a contabilidade', 'Transmitir no portal municipal', 'Salvar recibo e comprovante de entrega'],
  trabalhista: ['Confirmar competência e prazo oficial', 'Conferir admissões, afastamentos e desligamentos', 'Reconciliar folha, encargos e bases', 'Transmitir os eventos no portal oficial', 'Salvar recibos e relatório de fechamento'],
  outros: ['Confirmar período, escopo e prazo oficial', 'Reunir os documentos de origem', 'Revisar os dados com uma segunda pessoa', 'Executar e registrar o protocolo', 'Arquivar evidências da conclusão'],
};

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tokens(value) {
  return new Set(normalize(value).match(/[a-z0-9]{3,}/g) || []);
}

function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((token) => right.has(token)).length;
  return common / Math.sqrt(left.size * right.size);
}

export function localChecklistSuggestions(obligation, obligations = [], checklistItems = []) {
  const candidates = getSankhyaChecklistSuggestions(obligation);
  obligations.forEach((other) => {
    if (other.id === obligation.id) return;
    const score = similarity(`${obligation.name} ${obligation.category}`, `${other.name} ${other.category}`)
      + (other.category === obligation.category ? 0.35 : 0);
    checklistItems.filter((item) => item.obligation_id === other.id).forEach((item) => {
      candidates.push({ description: item.description, score, origin: 'Histórico da equipe' });
    });
  });

  const defaults = GENERIC_STEPS[obligation.category] || GENERIC_STEPS.outros;
  defaults.forEach((description, index) => candidates.push({
    description,
    score: 0.3 - (index * 0.01),
    origin: 'Modelo operacional local',
  }));

  const seen = new Set();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(({ description }) => {
      const key = normalize(description);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

export async function suggestChecklist(obligation, obligations, checklistItems, {
  fetchImpl = fetch,
  accessTokenProvider = getAccessToken,
  workspaceIdProvider = () => STATE.profile?.workspace_id,
} = {}) {
  const local = localChecklistSuggestions(obligation, obligations, checklistItems);
  try {
    const accessToken = await accessTokenProvider();
    if (!accessToken) throw Object.assign(new Error('Sessão ausente'), { authenticationFailure: true, status: 401 });
    const workspaceId = workspaceIdProvider();
    if (!workspaceId) throw Object.assign(new Error('Workspace ausente'), { authenticationFailure: true, status: 403 });
    const response = await fetchImpl(CHECKLIST_SUGGESTIONS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'x-workspace-id': workspaceId },
      body: JSON.stringify({ obligation: { id: obligation.id, name: obligation.name, category: obligation.category, frequency: obligation.frequency } }),
    });
    if ([401, 403].includes(response.status)) {
      throw Object.assign(new Error('Sua sessão ou acesso à empresa não é mais válido.'), { authenticationFailure: true, status: response.status });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.suggestions) || !data.suggestions.length) throw new Error('Resposta vazia');

    // Quando há um modelo exato vindo da planilha Sankhya, ele sempre fica no
    // topo. A IA complementa o modelo; não substitui um procedimento já
    // documentado pela equipe.
    const merged = [...getSankhyaChecklistSuggestions(obligation), ...data.suggestions];
    const seen = new Set();
    const suggestions = merged.filter(({ description }) => {
      const key = normalize(description);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);

    return { suggestions, mode: data.mode || 'IA', sources: data.sources || [] };
  } catch (error) {
    // Não apresente sugestões locais como se a chamada autenticada tivesse sido
    // autorizada. Falhas operacionais/IA ainda degradam de forma segura.
    if (error?.authenticationFailure || /Sessão ausente|Workspace ausente/.test(error?.message || '')) throw error;
    return { suggestions: local, mode: 'Modelo local', sources: [] };
  }
}
