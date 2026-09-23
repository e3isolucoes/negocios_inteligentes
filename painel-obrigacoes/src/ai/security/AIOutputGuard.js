import { AIError } from '../errors/AIError.js';
export class AIOutputGuard { validate(schema,value) { const result=schema.safeParse(value); if(!result.success) throw new AIError('INVALID_MODEL_OUTPUT','Output estruturado inválido',result.error); return result.data; } }
