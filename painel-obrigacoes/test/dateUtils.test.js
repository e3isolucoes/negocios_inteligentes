import assert from 'node:assert/strict';
import test from 'node:test';

import { fmtBR, fmtKey, occurrencesInRange, freqSummary } from '../js/dateUtils.js';

test('fmtBR não expõe NaN quando a data estiver ausente ou inválida', () => {
  assert.equal(fmtBR(new Date('')), '—');
  assert.equal(fmtBR(null), '—');
});

test('recorrência diária cria uma ocorrência para cada dia da semana', () => {
  const obligation = { frequency: 'diaria', business_day_shift: 'proximo_util' };
  const occurrences = occurrencesInRange(
    obligation,
    new Date(2026, 7, 10),
    new Date(2026, 7, 16),
  );

  assert.deepEqual(occurrences.map(fmtKey), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
    '2026-08-14', '2026-08-15', '2026-08-16',
  ]);
  assert.equal(freqSummary(obligation), 'Todos os dias da semana');
});

test('recorrências mensal e anual continuam avançando por mês e por ano', () => {
  const rangeStart = new Date(2026, 10, 1);
  const rangeEnd = new Date(2027, 1, 28);
  const monthly = occurrencesInRange(
    { frequency: 'mensal', day_type: 'fixo', day_of_month: 5, business_day_shift: 'nenhum' },
    rangeStart,
    rangeEnd,
  );
  const annual = occurrencesInRange(
    { frequency: 'anual', day_type: 'fixo', day_of_month: 1, month: 1, business_day_shift: 'nenhum' },
    rangeStart,
    rangeEnd,
  );

  assert.deepEqual(monthly.map(fmtKey), ['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
  assert.deepEqual(annual.map(fmtKey), ['2027-01-01']);
});
