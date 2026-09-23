import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SANKHYA_TEMPLATE_COUNT,
  getSankhyaChecklistModel,
  getSankhyaChecklistTemplate,
} from '../js/obligationChecklistTemplates.js';

test('planilha Sankhya gera um modelo por obrigação única', () => {
  assert.equal(SANKHYA_TEMPLATE_COUNT, 85);
});

test('modelo é encontrado ignorando acentos, caixa e pontuação', () => {
  const model = getSankhyaChecklistModel('APURACAO DO ICMS DIFAL POR UF DE DESTINO E OPERACAO MERCADO LIVRE');
  assert.ok(model);
  assert.equal(model.name, 'Apuracao do ICMS-DIFAL por UF de destino e operação Mercado Livre');
  assert.equal(model.tasks.length, 13);
});

test('DCTFWeb recebe as doze etapas detalhadas da planilha', () => {
  const tasks = getSankhyaChecklistTemplate('DCTFWeb');
  assert.equal(tasks.length, 12);
  assert.match(tasks[0], /Planejamento/);
  assert.match(tasks[0], /Confirmar aplicabilidade/);
  assert.ok(tasks.some((task) => task.includes('e-CAC')));
});
