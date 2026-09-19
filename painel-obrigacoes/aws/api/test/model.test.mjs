import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedEntities, entityConfig, entitySk, membershipPk, tenantPk } from '../src/model.mjs';

test('inclui todos os domínios persistidos pelo painel', () => {
  assert.deepEqual(new Set(allowedEntities), new Set([
    'profiles', 'companies', 'obligations', 'completions', 'obligation_comments', 'audit_log',
    'holidays', 'checklist_items', 'obligation_rules', 'obligation_date_overrides',
    'tax_regimes', 'tax_regime_rules', 'categories', 'workspaces'
  ]));
});

test('chaves separam ferramenta, ambiente e empresa', () => {
  assert.match(tenantPk('empresa-a'), /TOOL#painel-obrigacoes#ENV#dev#WORKSPACE#empresa-a$/);
  assert.notEqual(tenantPk('empresa-a'), tenantPk('empresa-b'));
  assert.match(membershipPk('usuario-1'), /#USER#usuario-1$/);
});

test('rejeita identificadores que poderiam escapar da fronteira', () => {
  assert.throws(() => tenantPk('../empresa'), /Empresa inválida/);
  assert.throws(() => entitySk('obligations', 'id/com/barra'), /Identificador inválido/);
});

test('membro autenticado pode criar obrigação no próprio workspace', () => {
  assert.ok(entityConfig('obligations').write.includes('member'));
  assert.ok(entityConfig('obligations').read.includes('member'));
});

test('entidades declaram a fronteira modular aplicada pelo backend', () => {
  assert.equal(entityConfig('obligations').grant, 'obrigacoes');
  assert.equal(entityConfig('audit_log').grant, 'administracao');
});
