import test from 'node:test';
import assert from 'node:assert/strict';

import { ReguaFechamento } from '../js/ui/ReguaFechamento.js';

test('filtra o escopo, calcula a conclusão e lista somente pendências acompanháveis', () => {
  const html = ReguaFechamento([
    { titulo: 'Conciliação bancária — Matriz', status: 'Sem pendência' },
    { titulo: 'Fechamento contábil mensal', status: 'No prazo' },
    { titulo: 'Conciliação de contas patrimoniais', status: 'Vencem em breve' },
    { titulo: 'Entrega DCTFWeb', status: 'No prazo' },
  ]);

  assert.match(html, /33%/);
  assert.match(html, /1 de 3 concluída\(s\)/);
  assert.match(html, /tone-red/);
  assert.match(html, /Fechamento contábil mensal/);
  assert.match(html, /Conciliação de contas patrimoniais/);
  assert.doesNotMatch(html, /Entrega DCTFWeb/);
  assert.doesNotMatch(html, /Conciliação bancária — Matriz/);
});

test('considera comprovante como conclusão e aplica os limites de cor', () => {
  const amarelo = ReguaFechamento([
    { name: 'Conciliação bancária', status: { label: 'No prazo', tone: 'green' }, attachment_path: 'arquivo.pdf' },
    { name: 'Fechamento contábil mensal', status: { label: 'No prazo', tone: 'green' } },
  ]);
  const verde = ReguaFechamento([
    { titulo: 'Conciliação bancária', comprovante_url: '/arquivo.pdf', status: 'No prazo' },
  ]);

  assert.match(amarelo, /50%/);
  assert.match(amarelo, /close-ruler-track tone-amber/);
  assert.match(verde, /100%/);
  assert.match(verde, /close-ruler-track tone-green/);
});

test('escapa conteúdo recebido e trata ausência de tarefas de fechamento', () => {
  const html = ReguaFechamento([{ titulo: 'Fechamento contábil mensal <script>', status: 'No prazo' }]);
  const vazio = ReguaFechamento([]);

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(vazio, /0 de 0 concluída\(s\)/);
});
