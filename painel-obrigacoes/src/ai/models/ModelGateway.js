export class ModelGateway { constructor(provider) { this.provider=provider; } generate(request) { return this.provider.generate(request); } }
