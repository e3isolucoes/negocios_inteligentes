import { AIError } from '../errors/AIError.js';
import { DEFAULT_CONTEXT_BUDGET, estimateTokens } from './ContextPolicy.js';

const SECRET_KEYS = /api[-_]?key|authorization|cookie|password|session[-_]?id|secret|credential|token/i;
const rank = (s) => [s.authorized !== false, s.relevance ?? 0, s.trustLevel === 'TRUSTED' ? 1 : 0, Date.parse(s.updatedAt || 0) || 0, -s.content.length];
export class ContextCompiler {
  constructor(budget = DEFAULT_CONTEXT_BUDGET) { this.budget = budget; }
  compile({ tenant, requirements = [], businessData = [] }) {
    if (!tenant?.organizationId) throw new AIError('INVALID_TENANT', 'Tenant obrigatório');
    const allowed = new Set(requirements.map((r) => r.type));
    const candidates = businessData.filter((s) => s.organizationId === tenant.organizationId && s.authorized !== false && (allowed.size === 0 || allowed.has(s.type)) && !SECRET_KEYS.test(s.sourceId) && !SECRET_KEYS.test(s.content));
    candidates.sort((a, b) => { const ar = rank(a), br = rank(b); for (let i=0;i<ar.length;i++) if (ar[i] !== br[i]) return ar[i] > br[i] ? -1 : 1; return 0; });
    const sections = []; let tokens = 0; let retrieved = 0; let chunks = 0;
    for (const item of candidates) {
      const next = estimateTokens(item.content);
      if (tokens + next > this.budget.maxContextTokens) continue;
      if (item.type === 'RETRIEVED_DOCUMENT' && ++retrieved > this.budget.maxRetrievedItems) continue;
      if (item.documentChunk && ++chunks > this.budget.maxDocumentChunks) continue;
      sections.push({ type:item.type, sourceId:item.sourceId, content:item.content, trustLevel:item.trustLevel, sensitivity:item.sensitivity }); tokens += next;
    }
    return { sections, sourceIds: sections.map((s) => s.sourceId), estimatedTokens: tokens };
  }
}
