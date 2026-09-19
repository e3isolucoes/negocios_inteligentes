import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_REGISTRY,
  getAvailableModules,
  getDefaultModule,
  getModuleById,
} from '../platform/module-registry.js';

test('catálogo central possui ids únicos', () => {
  const ids = MODULE_REGISTRY.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test('obrigações é o primeiro módulo ativo da plataforma', () => {
  assert.equal(getDefaultModule()?.id, 'obrigacoes');
  assert.equal(getModuleById('obrigacoes')?.entrypoint, './painel-obrigacoes/index.html');
  assert.deepEqual(getAvailableModules().map(({ id }) => id), ['obrigacoes']);
});

test('módulo inexistente não é resolvido', () => {
  assert.equal(getModuleById('inexistente'), null);
});
