import { AIError } from '../errors/AIError.js';
export class GeminiProvider {
  constructor({apiKey, fetchImpl=fetch}) { if(!apiKey) throw new AIError('PROVIDER_CONFIGURATION','GEMINI_API_KEY ausente'); this.apiKey=apiKey; this.fetch=fetchImpl; this.name='gemini'; }
  async generate(request) {
    const response=await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:request.systemInstruction}]},contents:request.messages.map(m=>({role:m.role,parts:[{text:m.content}]})),generationConfig:{responseMimeType:'application/json',responseJsonSchema:request.jsonSchema,maxOutputTokens:request.maxOutputTokens}}),signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new AIError('PROVIDER_UNAVAILABLE','Gemini indisponível'); const body=await response.json(); const text=body.candidates?.[0]?.content?.parts?.[0]?.text; if(!text) throw new AIError('INVALID_MODEL_OUTPUT','Gemini retornou saída vazia');
    let raw; try { raw=JSON.parse(text); } catch(e) { throw new AIError('INVALID_MODEL_OUTPUT','Saída não é JSON',e); }
    const parsed=request.outputSchema.safeParse(raw); if(!parsed.success) throw new AIError('INVALID_MODEL_OUTPUT','Saída não satisfaz o schema',parsed.error);
    const usage=body.usageMetadata||{}; return {provider:this.name,model:request.model,data:parsed.data,usage:{inputTokens:usage.promptTokenCount??null,outputTokens:usage.candidatesTokenCount??null,cachedTokens:usage.cachedContentTokenCount??null}};
  }
}
