import test from 'node:test';
import assert from 'node:assert/strict';
import { trainDelayRiskModel } from '../js/riskModel.js';

const obligations = [
  { id: 'risky', company_id: 'a', category: 'fiscal', responsible_id: 'u1' },
  { id: 'safe', company_id: 'b', category: 'rh', responsible_id: 'u2' },
];

function completion(obligation_id, occurrence_date, done_at) {
  return { obligation_id, occurrence_date, done_at };
}

test('modelo só prevê quando existe uma base mínima', () => {
  const model = trainDelayRiskModel(obligations, [completion('risky', '2026-01-10', '2026-01-11T12:00:00')]);
  assert.equal(model.ready, false);
  assert.equal(model.predict(obligations[0]), null);
});

test('modelo atribui mais atenção ao padrão com atrasos repetidos', () => {
  const rows = [
    completion('risky', '2026-01-10', '2026-01-12T12:00:00'),
    completion('risky', '2026-02-10', '2026-02-12T12:00:00'),
    completion('risky', '2026-03-10', '2026-03-12T12:00:00'),
    completion('safe', '2026-01-10', '2026-01-09T12:00:00'),
    completion('safe', '2026-02-10', '2026-02-09T12:00:00'),
    completion('safe', '2026-03-10', '2026-03-09T12:00:00'),
  ];
  const model = trainDelayRiskModel(obligations, rows);
  assert.equal(model.ready, true);
  assert.ok(model.predict(obligations[0]).probability > model.predict(obligations[1]).probability);
  assert.match(model.predict(obligations[0]).reason, /atrasou com mais frequência/);
});
