import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedOrigin, response } from '../src/handler.mjs';

test('CORS devolve a origem oficial em preflight e respostas da API', () => {
  process.env.ALLOWED_ORIGINS = 'https://obrigacoes.e3isolucoes.com.br,https://preview.example.test';

  const event = { headers: { origin: 'https://obrigacoes.e3isolucoes.com.br' } };
  assert.equal(allowedOrigin(event), 'https://obrigacoes.e3isolucoes.com.br');

  const result = response(401, { error: 'Autenticação obrigatória.' }, event);
  assert.equal(result.headers['access-control-allow-origin'], 'https://obrigacoes.e3isolucoes.com.br');
  assert.equal(result.headers['access-control-allow-credentials'], 'true');
  assert.match(result.headers['access-control-allow-headers'], /authorization/);
  assert.match(result.headers['access-control-allow-headers'], /x-workspace-id/);
  assert.match(result.headers['access-control-allow-methods'], /OPTIONS/);
});

test('CORS normaliza barra final e não reflete origem não autorizada', () => {
  process.env.ALLOWED_ORIGINS = 'https://obrigacoes.e3isolucoes.com.br/';

  assert.equal(
    allowedOrigin({ headers: { Origin: 'https://obrigacoes.e3isolucoes.com.br' } }),
    'https://obrigacoes.e3isolucoes.com.br',
  );

  const result = response(403, { error: 'negado' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.equal(result.headers['access-control-allow-credentials'], undefined);
});
