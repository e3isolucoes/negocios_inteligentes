import { AIError } from '../errors/AIError.js';
export class PromptRegistry {
  constructor(definitions = []) { this.items = new Map(definitions.map((d) => [`${d.id}@${d.version}`, d])); }
  active(id) { const found = [...this.items.values()].filter((p) => p.id === id && p.status === 'ACTIVE').sort((a,b)=>b.version-a.version)[0]; if (!found) throw new AIError('PROMPT_NOT_ACTIVE', `Prompt ativo não encontrado: ${id}`); return found; }
}
