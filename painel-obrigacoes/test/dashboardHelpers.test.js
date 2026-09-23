import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contarObrigacoesPorStatus,
  extrairTagsDaObrigacao,
  filtrarObrigacoesPorCategoria,
} from '../js/dashboardHelpers.js';

const obrigacoes = [
  { id: 1, titulo: 'DCTF', empresa: 'A', responsavel: 'Ana', frequencia: 'Mensal', data_vencimento: '2026-08-20', status: 'Atrasadas', categoria: 'Federal' },
  { id: 2, titulo: 'Balancete', empresa: 'B', responsavel: 'Bia', frequencia: 'Mensal', data_vencimento: '2026-08-21', status: 'Vencem em breve', categoria: 'Contábil' },
  { id: 3, titulo: 'Fluxo de caixa', empresa: 'C', responsavel: 'Caio', frequencia: 'Semanal', data_vencimento: '2026-08-22', status: 'No prazo', categoria: 'Financeiro' },
];

test('filtra obrigações pelos grupos executivos de categoria', () => {
  assert.deepEqual(filtrarObrigacoesPorCategoria(obrigacoes, 'Fiscal').map(({ id }) => id), [1]);
  assert.deepEqual(filtrarObrigacoesPorCategoria(obrigacoes, 'Contábil').map(({ id }) => id), [2]);
  assert.deepEqual(filtrarObrigacoesPorCategoria(obrigacoes, 'Controladoria').map(({ id }) => id), [3]);
});

test('filtra ocorrências enriquecidas usando as chaves persistidas', () => {
  const ocorrencias = [
    { ob: { id: 1, category: 'federal' }, status: { tone: 'green' } },
    { ob: { id: 2, category: 'contabil' }, status: { tone: 'green' } },
    { ob: { id: 3, category: 'financeiro' }, status: { tone: 'green' } },
  ];

  assert.deepEqual(filtrarObrigacoesPorCategoria(ocorrencias, 'Fiscal').map(({ ob }) => ob.id), [1]);
  assert.deepEqual(filtrarObrigacoesPorCategoria(ocorrencias, 'Contábil').map(({ ob }) => ob.id), [2]);
  assert.deepEqual(filtrarObrigacoesPorCategoria(ocorrencias, 'Controladoria').map(({ ob }) => ob.id), [3]);
});

test('extrai tags, limpa o título e preserva a obrigação original', () => {
  const obrigacao = { ...obrigacoes[0], titulo: 'DCTF #CRITICO, revisão #REFORMA' };

  assert.deepEqual(extrairTagsDaObrigacao(obrigacao), {
    ...obrigacao,
    titulo: 'DCTF, revisão',
    tags: ['#CRITICO', '#REFORMA'],
  });
  assert.equal(obrigacao.titulo, 'DCTF #CRITICO, revisão #REFORMA');
});

test('agrega somente os status executivos conhecidos', () => {
  assert.deepEqual(contarObrigacoesPorStatus([
    ...obrigacoes,
    { ...obrigacoes[0], id: 4 },
    { ...obrigacoes[0], id: 5, status: 'Concluída' },
  ]), {
    Atrasadas: 2,
    'Vencem em breve': 1,
    'No prazo': 1,
  });
});
