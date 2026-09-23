import { AIError } from '../errors/AIError.js'; import { TenantContextSchema, HumanControlLevel } from '../schemas/common.js';
export class AIPolicyEngine {
  constructor({featuresEnabled=true,allowedOperations=[],allowedModels=[]}={}) { this.featuresEnabled=featuresEnabled; this.allowedOperations=new Set(allowedOperations); this.allowedModels=new Set(allowedModels); }
  authorize({tenant,request,prompt,skills,model}) {
    if(!this.featuresEnabled) throw new AIError('AI_DISABLED','Funcionalidades de IA desabilitadas');
    if(!TenantContextSchema.safeParse(tenant).success) throw new AIError('INVALID_TENANT','TenantContext ou membership inválido');
    if(request.organizationId && request.organizationId!==tenant.organizationId) throw new AIError('TENANT_MISMATCH','Organização do request não é confiável');
    if(!this.allowedOperations.has(request.operation)) throw new AIError('OPERATION_DENIED','Operação não permitida');
    if(prompt.status!=='ACTIVE'||skills.some(s=>s.status!=='ACTIVE')) throw new AIError('POLICY_DENIED','Prompt ou skill inativa');
    if(!Number.isInteger(request.maxOutputTokens)||request.maxOutputTokens<1) throw new AIError('INVALID_BUDGET','Budget de output obrigatório');
    if(!this.allowedModels.has(model)) throw new AIError('MODEL_DENIED','Modelo não permitido');
    if(request.humanControl && ![HumanControlLevel.READ_ONLY,HumanControlLevel.RECOMMEND].includes(request.humanControl)) throw new AIError('HUMAN_CONTROL_REQUIRED','Nível de autonomia não permitido');
  }
}
