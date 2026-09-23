export class AIUsageRecorder { constructor(store={record:async()=>{}}) { this.store=store; } record(trace) { return this.store.record({...trace,cost:null}); } }
