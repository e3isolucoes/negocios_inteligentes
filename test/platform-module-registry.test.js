import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODULE_REGISTRY,
  getAvailableModules,
  getDefaultModule,
  getModuleById,
} from '../modules/registry.js';

test('catálogo central registra obrigações e suprimentos', () => {
  assert.deepEqual(MODULE_REGISTRY.map(({ id }) => id), ['obrigacoes', 'suprimentos']);
});

test('obrigações implementa o contrato explícito da plataforma', () => {
  const module = getModuleById('obrigacoes', { entitlements: new Set(['obrigacoes']) });

  assert.equal(module.id, 'obrigacoes');
  assert.equal(module.name, 'Obrigações');
  assert.equal(module.area, 'fiscal');
  assert.equal(module.requiredEntitlement, 'obrigacoes');
  assert.equal(typeof module.mount, 'function');
  assert.equal(typeof module.unmount, 'function');
});

test('OrçaFácil entra como módulo suprimentos com entitlement próprio', () => {
  const module = getModuleById('suprimentos', { entitlements: new Set(['suprimentos']) });

  assert.equal(module.id, 'suprimentos');
  assert.equal(module.name, 'OrçaFácil');
  assert.equal(module.area, 'suprimentos');
  assert.equal(module.requiredEntitlement, 'suprimentos');
  assert.equal(typeof module.mount, 'function');
  assert.equal(typeof module.unmount, 'function');
});

test('entitlement filtra o catálogo quando o contexto de permissões é fornecido', () => {
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set(['obrigacoes']) }).map(({ id }) => id),
    ['obrigacoes'],
  );
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set(['suprimentos']) }).map(({ id }) => id),
    ['suprimentos'],
  );
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set(['obrigacoes', 'suprimentos']) }).map(({ id }) => id),
    ['obrigacoes', 'suprimentos'],
  );
  assert.deepEqual(
    getAvailableModules({ entitlements: new Set() }).map(({ id }) => id),
    [],
  );
});

test('sem entitlements carregados o catálogo falha fechado', () => {
  assert.equal(getDefaultModule(), null);
  assert.equal(getModuleById('obrigacoes'), null);
  assert.equal(getModuleById('inexistente', { entitlements: new Set(['obrigacoes']) }), null);
});
