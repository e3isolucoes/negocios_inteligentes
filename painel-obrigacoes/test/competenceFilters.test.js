import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  competenceForOccurrence, competenceKey, competenceLabel,
} from '../js/state.js';

test('competência pode representar movimento anterior ao mês do vencimento', () => {
  const obligation = { competence_offset_months: 1 };
  const competence = competenceForOccurrence(obligation, '2026-09-20');

  assert.equal(competenceKey(competence), '2026-08');
  assert.equal(competenceLabel(competence), '08/2026');
});

test('competência atravessa a virada de ano sem alterar o vencimento', () => {
  const obligation = { competence_offset_months: 2 };
  const competence = competenceForOccurrence(obligation, '2026-01-15');

  assert.equal(competenceKey(competence), '2025-11');
  assert.equal(competenceLabel(competence), '11/2025');
});

test('obrigações antigas sem configuração mantêm competência no mês do vencimento', () => {
  const competence = competenceForOccurrence({}, '2026-09-20');
  assert.equal(competenceKey(competence), '2026-09');
});

test('toolbar oferece todos os módulos, competência e remoção explícita de filtros', async () => {
  const toolbar = await readFile(new URL('../js/ui/toolbar.js', import.meta.url), 'utf8');
  assert.match(toolbar, /Todos os módulos/);
  assert.match(toolbar, /Todas as competências/);
  assert.match(toolbar, /Remover filtros/);
  assert.match(toolbar, /module-filter/);
});

test('formulários de obrigação e regra permitem configurar período de movimento', async () => {
  const modal = await readFile(new URL('../js/ui/modal.js', import.meta.url), 'utf8');
  const ruleModal = await readFile(new URL('../js/ui/ruleModal.js', import.meta.url), 'utf8');

  assert.match(modal, /fCompetenceOffset/);
  assert.match(modal, /competence_offset_months/);
  assert.match(ruleModal, /rCompetenceOffset/);
  assert.match(ruleModal, /competence_offset_months/);
});

test('API AWS aceita deslocamento de competência em obrigações e modelos', async () => {
  const validators = await readFile(new URL('../aws/api/src/validators.mjs', import.meta.url), 'utf8');
  assert.match(validators, /competence_offset_months:\s*integer\(0, 36\)/);
});

test('histórico exibe competência separada do vencimento', async () => {
  const board = await readFile(new URL('../js/ui/board.js', import.meta.url), 'utf8');
  assert.match(board, /competência \$\{competenceLabel\(competence\)\} · vencimento/);
  assert.match(board, /competenceKey\(it\.competence\)/);
});
