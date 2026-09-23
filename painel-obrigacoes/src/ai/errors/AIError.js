export class AIError extends Error {
  constructor(code, message, cause) { super(message, { cause }); this.name = 'AIError'; this.code = code; }
}
