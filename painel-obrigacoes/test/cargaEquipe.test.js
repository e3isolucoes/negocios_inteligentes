import test from 'node:test';
import assert from 'node:assert/strict';

import { analisarCargaEquipe } from '../js/ui/CargaEquipe.js';

test('agrupa somente ocorrências ativas e ordena pela maior carga', () => {
  const ocorrencias = [
    { responsavel: 'Michele', status: 'Em andamento' },
    { responsavel: 'Wagner', status: 'Atrasada' },
    { responsavel: 'Michele', status: 'Concluída' },
    { ob: { responsible: 'Michele' }, status: { label: 'No prazo' } },
    { responsavel: '', status: 'Vence em breve' },
  ];

  assert.deepEqual(
    analisarCargaEquipe(ocorrencias).map(({ responsavel, quantidade }) => ({ responsavel, quantidade })),
    [
      { responsavel: 'Michele', quantidade: 2 },
      { responsavel: 'Sem responsável', quantidade: 1 },
      { responsavel: 'Wagner', quantidade: 1 },
    ],
  );
});

test('destaca apenas carga significativamente acima da média dos demais', () => {
  const ocorrencias = [
    ...Array.from({ length: 6 }, () => ({ responsavel: 'Wagner' })),
    ...Array.from({ length: 2 }, () => ({ responsavel: 'Michele' })),
    ...Array.from({ length: 2 }, () => ({ responsavel: 'Carol' })),
  ];

  const cargas = analisarCargaEquipe(ocorrencias);
  assert.equal(cargas.find(({ responsavel }) => responsavel === 'Wagner').sobrecarregado, true);
  assert.equal(cargas.find(({ responsavel }) => responsavel === 'Michele').sobrecarregado, false);
});
