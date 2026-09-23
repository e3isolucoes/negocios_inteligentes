import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarObrigacoesCriticas } from '../js/ui/TermometroRisco.js';

test('filtra termos críticos apenas na zona de perigo', () => {
  const obrigacoes = [
    { titulo: 'DARF COFINS mensal', status: 'Vencem em breve', responsavel: 'Wagner' },
    { titulo: 'Apuração de ICMS', status: 'Atrasada', responsavel: 'Michele' },
    { titulo: 'Entrega DCTFWeb', status: 'No prazo', responsavel: 'Wagner' },
    { titulo: 'ISS mensal', status: 'Atrasada', responsavel: 'Michele' },
  ];

  assert.deepEqual(filtrarObrigacoesCriticas(obrigacoes), obrigacoes.slice(0, 2));
});

test('aceita os campos usados internamente pelo painel', () => {
  const obrigacao = { name: 'DCTFWeb anual', status: { label: 'Atrasadas' }, responsible: 'Ana' };
  assert.deepEqual(filtrarObrigacoesCriticas([obrigacao]), [obrigacao]);
});

test('normaliza caixa, acentos e entradas inválidas', () => {
  assert.equal(filtrarObrigacoesCriticas([{ titulo: 'icms', status: 'atrasadá' }]).length, 1);
  assert.deepEqual(filtrarObrigacoesCriticas(null), []);
});
