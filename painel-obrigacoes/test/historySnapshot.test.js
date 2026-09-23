import assert from 'node:assert/strict';
import test from 'node:test';

import {
  competenceForCompletion,
  competenceLabel,
  obligationForCompletion,
} from '../js/state.js';

test('conclusão usa competência e estrutura congeladas mesmo depois de editar a obrigação', () => {
  const current = {
    id: 'ob-1',
    name: 'Nome atual',
    company_id: 'company-new',
    competence_offset_months: 0,
  };
  const completion = {
    obligation_id: 'ob-1',
    occurrence_date: '2026-09-20',
    done_at: '2026-09-21T10:00:00.000Z',
    competence_date: '2026-08-01',
    obligation_snapshot: {
      name: 'Nome da época',
      company_id: 'company-old',
      company_name: 'Empresa da época',
      competence_offset_months: 1,
    },
  };

  const historical = obligationForCompletion(completion, current);
  assert.equal(historical.name, 'Nome da época');
  assert.equal(historical.company_id, 'company-old');
  assert.equal(historical.company_name, 'Empresa da época');
  assert.equal(competenceLabel(competenceForCompletion(completion, current)), '08/2026');
});

test('conclusão legada sem snapshot usa a versão estrutural vigente na data da conclusão', () => {
  const current = {
    id: 'ob-1',
    name: 'Depois da alteração',
    competence_offset_months: 0,
    structure_history: [{
      effective_until: '2026-09-10T12:00:00.000Z',
      snapshot: {
        name: 'Antes da alteração',
        competence_offset_months: 1,
      },
    }],
  };

  const oldCompletion = {
    obligation_id: 'ob-1',
    occurrence_date: '2026-09-20',
    done_at: '2026-09-05T10:00:00.000Z',
  };
  const newCompletion = {
    obligation_id: 'ob-1',
    occurrence_date: '2026-09-20',
    done_at: '2026-09-15T10:00:00.000Z',
  };

  assert.equal(obligationForCompletion(oldCompletion, current).name, 'Antes da alteração');
  assert.equal(competenceLabel(competenceForCompletion(oldCompletion, current)), '08/2026');
  assert.equal(obligationForCompletion(newCompletion, current).name, 'Depois da alteração');
  assert.equal(competenceLabel(competenceForCompletion(newCompletion, current)), '09/2026');
});
