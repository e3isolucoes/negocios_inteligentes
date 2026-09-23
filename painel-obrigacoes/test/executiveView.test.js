import test from 'node:test';
import assert from 'node:assert/strict';

import { renderExecutiveView, selecionarVisaoExecutiva } from '../js/ui/executiveView.js';

const obrigacoes = [
  { id: 1, categoria: 'Federal' },
  { id: 2, categoria: 'Contábil' },
  { id: 3, categoria: 'Financeiro' },
];

test('renderiza os recortes gerenciais e entrega somente a área ativa ao dashboard', () => {
  selecionarVisaoExecutiva('Fiscal');
  const html = renderExecutiveView(obrigacoes, (itens) => `<output>${itens.map(({ id }) => id)}</output>`);

  assert.match(html, /Visão Fiscal/);
  assert.match(html, /Gestão Geral/);
  assert.match(html, /Visão Contábil/);
  assert.match(html, /Visão Controladoria/);
  assert.match(html, /<output>1<\/output>/);
  assert.match(html, /aria-selected="true"/);
});

test('alterna a visão e ignora identificadores desconhecidos', () => {
  selecionarVisaoExecutiva('Controladoria');
  let html = renderExecutiveView(obrigacoes, (itens) => `<output>${itens.map(({ id }) => id)}</output>`);
  assert.match(html, /<output>3<\/output>/);

  selecionarVisaoExecutiva('Desconhecida');
  html = renderExecutiveView(obrigacoes, (itens) => `<output>${itens.map(({ id }) => id)}</output>`);
  assert.match(html, /<output>3<\/output>/);
});
