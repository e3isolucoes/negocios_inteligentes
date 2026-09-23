import { AIError } from '../errors/AIError.js';
const forbidden=/(-----BEGIN .*PRIVATE KEY-----|\bBearer\s+[\w.-]+|(?:api[_-]?key|password|cookie|session[_-]?id|secret)\s*[:=])/i;
export class AIInputGuard { validate(value) { const text=JSON.stringify(value); if(forbidden.test(text)) throw new AIError('SENSITIVE_INPUT','Credencial ou segredo detectado'); return value; } }
