import { AIError } from '../errors/AIError.js';
export const ModelProfile=Object.freeze({NO_MODEL:'NO_MODEL',FAST:'FAST',BALANCED:'BALANCED',REASONING:'REASONING'});
export class ModelRouter { constructor(models) { this.models=models; } route(profile) { if(profile==='NO_MODEL') return null; const model=this.models[profile]; if(!model) throw new AIError('MODEL_NOT_CONFIGURED',`Modelo não configurado: ${profile}`); return model; } }
