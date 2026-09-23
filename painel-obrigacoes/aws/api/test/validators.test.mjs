import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreate, validateUpdate } from '../src/validators.mjs';

const valid = {
  profiles: { email: 'user@example.com', display_name: 'Usuário', role: 'member' },
  companies: { name: 'Empresa' },
  obligations: { name: 'DCTFWeb', category: 'federal', frequency: 'mensal', day_of_month: 15 },
  completions: { obligation_id: 'obligation-a', occurrence_date: '2026-09-01', done_by_name: 'Usuário' },
  obligation_comments: { obligation_id: 'obligation-a', author_name: 'Usuário', body: 'Comentário' },
  holidays: { holiday_date: '2026-09-07', name: 'Independência' },
  checklist_items: { obligation_id: 'obligation-a', description: 'Enviar declaração' },
  obligation_rules: { name: 'DCTFWeb', category: 'federal', frequency: 'mensal', day_of_month: 15 },
  obligation_date_overrides: { obligation_id: 'obligation-a', original_date: '2026-09-01', override_date: '2026-09-02' },
  tax_regimes: { name: 'Simples Nacional' },
  tax_regime_rules: { tax_regime_id: 'regime-a', obligation_rule_id: 'rule-a' },
  categories: { name: 'federal' },
  workspaces: { name: 'Empresa A' }
};

for (const [entity, payload] of Object.entries(valid)) {
  test(`${entity}: rejeita campo obrigatório ausente`, () => {
    const [required] = Object.keys(payload);
    const missing = { ...payload };
    delete missing[required];
    assert.throws(() => validateCreate(entity, missing), /Campo obrigatório:/);
  });

  test(`${entity}: rejeita campos desconhecidos`, () => {
    assert.throws(() => validateCreate(entity, { ...payload, administrador: true }), /Campo não permitido: administrador/);
  });

  test(`${entity}: rejeita payload com campos demais`, () => {
    const excessive = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`campo_${index}`, index]));
    assert.throws(() => validateCreate(entity, excessive), /Payload possui campos demais/);
  });
}

const enumCases = [
  ['profiles', 'role'], ['obligations', 'frequency'], ['completions', 'movement_status'],
  ['holidays', 'scope'], ['obligation_rules', 'frequency']
];
for (const [entity, field] of enumCases) {
  test(`${entity}: rejeita enum inválido`, () => {
    assert.throws(() => validateCreate(entity, { ...valid[entity], [field]: 'valor_inexistente' }), new RegExp(`Valor não permitido: ${field}`));
  });
}

test('completions normaliza identificador e data e exige ambos', () => {
  const output = validateCreate('completions', { ...valid.completions, obligation_id: ' obligation-a ', occurrence_date: ' 2026-09-01 ' });
  assert.equal(output.obligation_id, 'obligation-a');
  assert.equal(output.occurrence_date, '2026-09-01');
  assert.throws(() => validateCreate('completions', { done_by_name: 'Usuário', occurrence_date: '2026-09-01' }), /Campo obrigatório: obligation_id/);
  assert.throws(() => validateCreate('completions', { done_by_name: 'Usuário', obligation_id: 'obligation-a' }), /Campo obrigatório: occurrence_date/);
  assert.throws(() => validateCreate('completions', { ...valid.completions, occurrence_date: '2026-02-30' }), /Data inválida: occurrence_date/);
});

test('atualizações possuem lista positiva de campos e limite de tamanho', () => {
  assert.deepEqual(validateUpdate('companies', { name: ' Nova empresa ', version: 2 }), { name: 'Nova empresa', version: 2 });
  assert.throws(() => validateUpdate('companies', { workspace_id: 'outro-tenant' }), /Campo não permitido: workspace_id/);
  assert.throws(() => validateUpdate('companies', { name: 'x'.repeat(201) }), /Campo excede o tamanho máximo: name/);
});
