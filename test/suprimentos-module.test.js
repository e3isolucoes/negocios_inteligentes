import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('OrçaFácil preserva a lógica de decisão e troca somente a persistência', () => {
  const app = fs.readFileSync(new URL('../suprimentos/app.js', import.meta.url), 'utf8');

  assert.match(app, /function decisionReport\(data\)/);
  assert.match(app, /function buildModel\(data\)/);
  assert.match(app, /platformRequest\('\/v1\/modules\/suprimentos\/pedidos-compra'/);
  assert.doesNotMatch(app, /fetch\('\/api\/analyses'/);
  assert.match(app, /getAccessToken/);
});

test('módulo suprimentos carrega configuração AWS da plataforma', () => {
  const page = fs.readFileSync(new URL('../suprimentos/index.html', import.meta.url), 'utf8');

  assert.match(page, /painel-obrigacoes\/js\/runtime-config\.js/);
  assert.match(page, /<script type="module" src="app\.js"><\/script>/);
  assert.match(page, /OrçaFácil/);
});

test('contrato de pedido de compra declara o RECORD genérico de suprimentos', () => {
  const schema = JSON.parse(fs.readFileSync(
    new URL('../modules/suprimentos/contracts/pedido-compra.schema.json', import.meta.url),
    'utf8',
  ));

  assert.equal(schema['x-e3i'].moduleId, 'suprimentos');
  assert.equal(schema['x-e3i'].recordType, 'pedido-compra');
  assert.deepEqual(schema.required, ['description']);
});
