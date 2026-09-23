import { AIError } from './errors/AIError.js';
export function loadAIConfig(env=process.env) {
  const provider=env.AI_PROVIDER||'gemini';
  if(provider==='mock'&&env.NODE_ENV!=='test') throw new AIError('MOCK_FORBIDDEN','AI_PROVIDER=mock é permitido apenas em testes');
  return {featuresEnabled:env.AI_FEATURES_ENABLED==='true',provider,models:{FAST:env.AI_MODEL_FAST,BALANCED:env.AI_MODEL_BALANCED,REASONING:env.AI_MODEL_REASONING}};
}
