export const DEFAULT_CONTEXT_BUDGET = Object.freeze({ maxContextTokens: 2000, maxRetrievedItems: 8, maxDocumentChunks: 12 });
export const estimateTokens = (text) => Math.ceil(text.length / 4);
