import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRecord } from '../src/model.mjs';
import { validateCreate, validateUpdate } from '../src/validators.mjs';
import { frontendPayloads } from './fixtures/frontend-payloads.mjs';

const createCases = [
  ['obligations', 'obligation'], ['completions', 'completion'], ['categories', 'category'],
  ['checklist_items', 'checklist'], ['obligation_rules', 'rule'], ['profiles', 'profileLegacy'],
  ['workspaces', 'workspaceTrial']
];

for (const [entity, fixture] of createCases) {
  test(`contrato frontend: AWS aceita payload de ${entity}`, () => {
    assert.doesNotThrow(() => validateCreate(entity, frontendPayloads[fixture]));
  });
}

test('contrato frontend: status e roles usam representação AWS canônica', () => {
  assert.equal(validateCreate('profiles', frontendPayloads.profileLegacy).role, 'manager');
  assert.equal(validateUpdate('completions', frontendPayloads.approve).status, 'validada');
  assert.equal(validateUpdate('completions', frontendPayloads.reject).status, 'rejeitada');
});

test('leitura converte aliases legados sem alterar valores desconhecidos', () => {
  assert.equal(publicRecord({ entityType: 'completions', status: 'validado' }).status, 'validada');
  assert.equal(publicRecord({ entityType: 'completions', status: 'rejeitado' }).status, 'rejeitada');
  assert.equal(publicRecord({ entityType: 'profiles', role: 'membro' }).role, 'member');
  assert.equal(publicRecord({ entityType: 'profiles', role: 'gestor' }).role, 'manager');
  assert.equal(publicRecord({ entityType: 'completions', status: 'corrompido' }).status, 'corrompido');
});

test('contrato negativo: campo e workspace injetados são rejeitados', () => {
  assert.throws(() => validateCreate('categories', { ...frontendPayloads.category, root: true }), /Campo não permitido: root/);
  assert.throws(() => validateCreate('obligations', { ...frontendPayloads.obligation, workspace_id: 'empresa-b' }), /Campo não permitido: workspace_id/);
});

test('contrato negativo: estados e combinações inválidas são rejeitados', () => {
  assert.throws(() => validateUpdate('completions', { status: 'cancelada' }), /Valor não permitido: status/);
  assert.throws(() => validateUpdate('completions', { status: 'rejeitada', rejection_reason: null }), /Motivo obrigatório/);
  assert.throws(() => validateCreate('workspaces', { name: 'Empresa', access_status: 'trial' }), /trial_ends_at/);
});
