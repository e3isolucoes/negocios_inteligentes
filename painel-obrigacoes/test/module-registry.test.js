import assert from 'node:assert/strict';
import test from 'node:test';
import { hasModuleGrant, ModuleRegistry, moduleContext } from '../js/modules/registry.js';

const context = moduleContext({
  state: { profile: { workspace_id: 'empresa-a' }, session: { id: 'user-a' } },
  permissions: { manager: false }
});

test('registro aceita módulos isolados e ordena o catálogo', () => {
  const registry = new ModuleRegistry()
    .register({ id: 'relatorios', order: 20, render: () => 'relatórios' })
    .register({ id: 'obrigacoes', order: 10, render: () => 'obrigações' });
  assert.deepEqual(registry.available(context).map((item) => item.id), ['obrigacoes', 'relatorios']);
});

test('módulo desabilitado ou sem permissão não pode ser resolvido', () => {
  const registry = new ModuleRegistry({ enabledModules: ['obrigacoes'] })
    .register({ id: 'obrigacoes', render: () => 'ok' })
    .register({ id: 'administracao', canAccess: ({ permissions }) => permissions.manager, render: () => 'admin' });
  assert.equal(registry.get('administracao', context), null);
  assert.equal(registry.get('obrigacoes', context).render(), 'ok');
});

test('registro rejeita contratos inválidos e duplicados', () => {
  const registry = new ModuleRegistry().register({ id: 'obrigacoes', render: () => 'ok' });
  assert.throws(() => registry.register({ id: 'obrigacoes', render: () => 'duplicado' }), /duplicado/i);
  assert.throws(() => registry.register({ id: '../escape', render: () => 'x' }), /identificador inválido/i);
  assert.throws(() => registry.register({ id: 'sem-render' }), /render/);
});

test('obrigações permanecem acessíveis para usuário ativo mesmo com grants explícitos vazios', () => {
  const restrictedContext = moduleContext({
    state: { profile: { workspace_id: 'empresa-a', active: true, module_grants: [] }, session: { id: 'user-a' } },
    permissions: { manager: true }
  });
  const registry = new ModuleRegistry()
    .register({ id: 'board', requiredGrant: 'obrigacoes', render: () => 'ok' })
    .register({ id: 'reports', requiredGrant: 'relatorios', render: () => 'negado' });
  assert.ok(registry.get('board', restrictedContext));
  assert.equal(registry.get('reports', restrictedContext), null);
});

test('perfil legado preserva módulos e somente obrigações viram capacidade básica', () => {
  assert.equal(hasModuleGrant({}, 'relatorios'), true);
  assert.equal(hasModuleGrant({ active: true, module_grants: [] }, 'obrigacoes'), true);
  assert.equal(hasModuleGrant({ active: true, module_grants: [] }, 'relatorios'), false);
  assert.equal(hasModuleGrant({ active: true, module_grants: ['obrigacoes'] }, 'relatorios'), false);
  assert.equal(hasModuleGrant({ active: false, module_grants: [] }, 'obrigacoes'), false);
});
