import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_REGISTRY,
  getAvailableModules,
  getDefaultModule,
  getModuleById,
} from '../modules/registry.js';

test('catálogo central possui somente o módulo obrigações', () => {
  assert.deepEqual(MODULE_REGISTRY.map(({ id }) => id), ['obrigacoes']);
});

test('obrigações implementa o contrato explícito da plataforma', () => {
  const module = getModuleById('obrigacoes');

  assert.equal(module.id, 'obrigacoes');
  assert.equal(module.name, 'Obrigações');
  assert.equal(module.area, 'fiscal');
  assert.equal(module.requiredEntitlement, 'obrigacoes');
  assert.equal(typeof module.mount, 'function');
  assert.equal(typeof module.unmount, 'function');
});

test('entitlement filtra o catálogo quando o contexto de permissões é fornecido', () => {
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set(['obrigacoes']) }).map(({ id }) => id),
    ['obrigacoes'],
  );
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set() }).map(({ id }) => id),
    [],
  );
});

test('sem motor de entitlements injetado preserva compatibilidade atual', () => {
  assert.equal(getDefaultModule()?.id, 'obrigacoes');
  assert.equal(getModuleById('inexistente'), null);
});
