import test from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORIES } from '../js/constants.js';
import { validateImportRows } from '../js/csv.js';

function validRow(overrides = {}) {
  return {
    nome: 'Obrigação de teste',
    categoria: 'Federal',
    frequencia: 'mensal',
    tipo_dia: 'fixo',
    dia: '10',
    ...overrides,
  };
}

test('aceita o rótulo de categoria sem diferenciar caixa ou acentos', () => {
  const [row] = validateImportRows([validRow({ categoria: '  SOCIETÁRIA ' })]);

  assert.equal(row.valid, true);
  assert.equal(row.mapped.category, 'societaria');
});

test('preserva a chave cadastrada ao reconhecer chave ou rótulo dinâmico', () => {
  const original = CATEGORIES.map((category) => ({ ...category }));
  CATEGORIES.splice(0, CATEGORIES.length, {
    key: 'Contábil',
    label: 'Contábil',
    color: '#000000',
  });

  try {
    const [row] = validateImportRows([validRow({ categoria: 'contabil' })]);
    assert.equal(row.valid, true);
    assert.equal(row.mapped.category, 'Contábil');
  } finally {
    CATEGORIES.splice(0, CATEGORIES.length, ...original);
  }
});

test('aceita obrigação diária sem exigir dia, mês ou data', () => {
  const [row] = validateImportRows([validRow({
    frequencia: 'diaria',
    dia: '',
  })]);

  assert.equal(row.valid, true);
  assert.equal(row.mapped.frequency, 'diaria');
  assert.equal(row.mapped.day_of_month, null);
});
