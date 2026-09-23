import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarDivergencias } from '../js/ui/PainelDivergencias.js';

test('filtra ocorrências do escopo ignorando caixa e acentos', () => {
  const ocorrencias = [
    { titulo: 'Divergência de estoque', status: 'Pendente' },
    { titulo: 'Conciliação faturamento x NF-e', status: 'Vence em breve' },
    { titulo: 'Análise de margem', status: 'Atrasada' },
    { titulo: 'Pagamento de ICMS', status: 'Pendente' },
  ];

  assert.deepEqual(filtrarDivergencias(ocorrencias), ocorrencias.slice(0, 3));
});

test('aceita ocorrências enriquecidas e remove itens concluídos', () => {
  const pendente = { ob: { name: 'Auditoria de caixa' }, status: { label: 'No prazo', tone: 'green' } };
  const concluida = { ob: { name: 'Auditoria fiscal' }, status: { label: 'Sem pendência', tone: 'muted' } };

  assert.deepEqual(filtrarDivergencias([pendente, concluida]), [pendente]);
  assert.deepEqual(filtrarDivergencias(null), []);
});
