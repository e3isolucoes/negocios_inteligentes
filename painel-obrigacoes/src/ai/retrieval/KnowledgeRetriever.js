/** @typedef {{organizationId:string,query:string,limit:number}} RetrievalRequest @typedef {{organizationId:string,sourceId:string,content:string,score:number,sourceType:string}} RetrievalResult */
export class KnowledgeRetriever { retrieve() { throw new Error('KnowledgeRetriever é apenas um extension point'); } }
