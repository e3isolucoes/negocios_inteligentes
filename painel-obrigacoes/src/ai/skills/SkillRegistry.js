import { AIError } from '../errors/AIError.js';
export class SkillRegistry { constructor(items=[]) { this.items=new Map(items.map(x=>[x.id,x])); } resolve(ids=[]) { return ids.map(id=>{const x=this.items.get(id); if(!x||x.status!=='ACTIVE') throw new AIError('SKILL_NOT_ALLOWED',`Skill indisponível: ${id}`); return x;}); } }
