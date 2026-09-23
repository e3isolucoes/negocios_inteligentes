export class AIHarness {
  constructor({contextCompiler,policyEngine,promptRegistry,skillRegistry,modelRouter,gateway,inputGuard,outputGuard,trace}) { Object.assign(this,{contextCompiler,policyEngine,promptRegistry,skillRegistry,modelRouter,gateway,inputGuard,outputGuard,trace}); }
  async execute(tenant,request,businessData=[]) {
    const prompt=this.promptRegistry.active(request.promptId); const skills=this.skillRegistry.resolve(request.skillIds||[]); const model=this.modelRouter.route(prompt.modelProfile);
    this.policyEngine.authorize({tenant,request,prompt,skills,model}); this.inputGuard.validate(request.input);
    const context=this.contextCompiler.compile({tenant,operation:request.operation,requirements:request.contextRequirements,businessData});
    const started=this.trace.start({organizationId:tenant.organizationId,operation:request.operation,promptId:prompt.id,promptVersion:prompt.version,skillIds:skills.map(s=>s.id),provider:this.gateway.provider.name,model});
    let result;
    try {
      result=await this.gateway.generate({model,systemInstruction:[prompt.systemInstructions,...skills.map(s=>s.instructions)].join('\n'),messages:[{role:'user',content:JSON.stringify({input:request.input,contextSections:context.sections.map(s=>({type:s.type,sourceId:s.sourceId,content:s.content}))})}],outputSchema:request.outputSchema||prompt.outputContract,jsonSchema:prompt.jsonSchema,maxOutputTokens:request.maxOutputTokens});
      const data=this.outputGuard.validate(request.outputSchema||prompt.outputContract,result.data); await this.trace.finish(started,result); return {data,evidence:{sourceIds:context.sourceIds,inferenceType:'FACT'},traceId:started.traceId};
    } catch(error) { await this.trace.finish(started,result,error); throw error; }
  }
}
