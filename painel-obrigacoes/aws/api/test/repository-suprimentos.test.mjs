import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PEDIDO_COMPRA_RECORD_TYPE,
  SUPRIMENTOS_MODULE_ID,
  SuprimentosRepository,
  normalizePedidoCompraInput,
} from '../src/repository-suprimentos.mjs';

test('preserva o contrato de entrada atualmente usado pelo OrçaFácil', () => {
  assert.deepEqual(normalizePedidoCompraInput({
    description: '  Comprar notebooks  ',
    budget: ' R$ 120.000 ',
    quantity: '20',
    ignored: 'não deve persistir',
  }), {
    description: 'Comprar notebooks',
    budget: 'R$ 120.000',
    deadline: '',
    location: '',
    quantity: '20',
    preferences: '',
    constraints: '',
    criteria: '',
    alternatives: '',
  });
});

test('rejeita solicitação vazia como o OrçaFácil atual', () => {
  assert.throws(
    () => normalizePedidoCompraInput({ description: '   ' }),
    (error) => error.statusCode === 422 && /solicitação é obrigatória/i.test(error.message),
  );
});

test('adapter persiste análise como RECORD de suprimentos sem alterar o contrato de resposta', async () => {
  let received;
  const repository = new SuprimentosRepository({
    async putRecord(workspaceId, input) {
      received = { workspaceId, input };
      return { record_id: 'pedido-123' };
    },
  });

  const result = await repository.createPedidoCompra(
    { workspaceId: 'empresa-a' },
    { description: 'Comprar notebooks', budget: 'R$ 120.000' },
  );

  assert.deepEqual(result, { id: 'pedido-123', saved: true });
  assert.equal(received.workspaceId, 'empresa-a');
  assert.equal(received.input.moduleId, SUPRIMENTOS_MODULE_ID);
  assert.equal(received.input.recordType, PEDIDO_COMPRA_RECORD_TYPE);
  assert.equal(received.input.data.description, 'Comprar notebooks');
  assert.equal(received.input.data.budget, 'R$ 120.000');
});

test('adapter cria relação semântica com obrigação fiscal existente', async () => {
  let received;
  const repository = new SuprimentosRepository({
    async putRelation(workspaceId, input) {
      received = { workspaceId, input };
      return input;
    },
  });

  await repository.linkFiscalObligation(
    { workspaceId: 'empresa-a' },
    'pedido-123',
    'obrigacao-retencao-1',
    { motivo: 'Compra sujeita a retenção tributária' },
  );

  assert.equal(received.workspaceId, 'empresa-a');
  assert.deepEqual(received.input, {
    recordModuleId: 'suprimentos',
    recordType: 'pedido-compra',
    recordId: 'pedido-123',
    relatedModuleId: 'obrigacoes',
    relatedRecordType: 'activity',
    relatedRecordId: 'obrigacao-retencao-1',
    relationType: 'gera-obrigacao-fiscal',
    data: { motivo: 'Compra sujeita a retenção tributária' },
  });
});
