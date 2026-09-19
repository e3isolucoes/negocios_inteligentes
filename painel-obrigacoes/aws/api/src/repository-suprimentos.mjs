export const SUPRIMENTOS_MODULE_ID = 'suprimentos';
export const PEDIDO_COMPRA_RECORD_TYPE = 'pedido-compra';
export const ORCAFACIL_MAX_FIELD_LENGTH = 5000;

const ORCAFACIL_FIELDS = [
  'description',
  'budget',
  'deadline',
  'location',
  'quantity',
  'preferences',
  'constraints',
  'criteria',
  'alternatives',
];

export function normalizePedidoCompraInput(input = {}) {
  const normalized = Object.fromEntries(
    ORCAFACIL_FIELDS.map((field) => [
      field,
      typeof input?.[field] === 'string' ? input[field].trim() : '',
    ]),
  );

  if (!normalized.description) {
    throw Object.assign(new Error('A solicitação é obrigatória.'), { statusCode: 422 });
  }
  if (Object.values(normalized).some((value) => value.length > ORCAFACIL_MAX_FIELD_LENGTH)) {
    throw Object.assign(
      new Error(`Cada campo deve ter no máximo ${ORCAFACIL_MAX_FIELD_LENGTH} caracteres.`),
      { statusCode: 422 },
    );
  }

  return normalized;
}

export class SuprimentosRepository {
  constructor(genericRepository) {
    this.genericRepository = genericRepository;
  }

  async createPedidoCompra(auth, input = {}) {
    const data = normalizePedidoCompraInput(input);
    const record = await this.genericRepository.putRecord(auth.workspaceId, {
      moduleId: SUPRIMENTOS_MODULE_ID,
      recordType: PEDIDO_COMPRA_RECORD_TYPE,
      data,
    });

    // Preserva o contrato usado hoje pelo OrçaFácil.
    return {
      id: record.record_id,
      saved: true,
    };
  }

  async listPedidosCompra(auth, options = {}) {
    return this.genericRepository.queryRecordsByModule(
      auth.workspaceId,
      SUPRIMENTOS_MODULE_ID,
      { ...options, recordType: PEDIDO_COMPRA_RECORD_TYPE },
    );
  }

  async getPedidoCompra(auth, recordId) {
    return this.genericRepository.getRecord(
      auth.workspaceId,
      SUPRIMENTOS_MODULE_ID,
      PEDIDO_COMPRA_RECORD_TYPE,
      recordId,
    );
  }

  async linkFiscalObligation(auth, pedidoId, obligationId, data = {}) {
    return this.genericRepository.putRelation(auth.workspaceId, {
      recordModuleId: SUPRIMENTOS_MODULE_ID,
      recordType: PEDIDO_COMPRA_RECORD_TYPE,
      recordId: pedidoId,
      relatedModuleId: 'obrigacoes',
      relatedRecordType: 'activity',
      relatedRecordId: obligationId,
      relationType: 'gera-obrigacao-fiscal',
      data,
    });
  }

  async listConnections(auth, pedidoId, options = {}) {
    return this.genericRepository.listRelationsOfRecord(
      auth.workspaceId,
      pedidoId,
      { ...options, moduleId: SUPRIMENTOS_MODULE_ID },
    );
  }
}
