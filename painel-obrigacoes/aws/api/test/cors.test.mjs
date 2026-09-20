import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedOrigin, handler, response } from '../src/handler.mjs';

test('CORS devolve a origem oficial também em respostas de erro', () => {
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

test('handler OPTIONS responde preflight operacional sem autenticação', async () => {
  const origin = 'https://obrigacoes.e3isolucoes.com.br';
  const result = await handler({
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization,content-type,x-workspace-id',
    },
    requestContext: {
      requestId: 'cors-preflight-test',
      http: { method: 'OPTIONS' },
    },
    rawPath: '/v1/obligations',
  });

  assert.equal(result.statusCode, 204);
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.equal(result.headers['access-control-allow-credentials'], 'true');
  assert.match(result.headers['access-control-allow-headers'], /authorization/);
  assert.match(result.headers['access-control-allow-headers'], /x-workspace-id/);
  assert.match(result.headers['access-control-allow-methods'], /OPTIONS/);
});

test('CORS normaliza barra final e nunca reflete origem não autorizada', () => {
  process.env.ALLOWED_ORIGINS = 'https://obrigacoes.e3isolucoes.com.br/';

  assert.equal(
    allowedOrigin({ headers: { Origin: 'https://obrigacoes.e3isolucoes.com.br' } }),
    'https://obrigacoes.e3isolucoes.com.br',
  );

  const result = response(403, { error: 'negado' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.equal(result.headers['access-control-allow-credentials'], undefined);
});


test('CORS mantém a origem oficial mesmo quando a configuração de ambiente deriva', () => {
  const previousAllowedOrigins = process.env.ALLOWED_ORIGINS;
  const previousAllowedOrigin = process.env.ALLOWED_ORIGIN;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.ALLOWED_ORIGIN;

  try {
    assert.equal(
      allowedOrigin({ headers: { origin: 'https://obrigacoes.e3isolucoes.com.br' } }),
      'https://obrigacoes.e3isolucoes.com.br',
    );

    const result = response(
      401,
      { error: 'Autenticação obrigatória.' },
      { headers: { origin: 'https://obrigacoes.e3isolucoes.com.br' } },
    );
    assert.equal(result.headers['access-control-allow-origin'], 'https://obrigacoes.e3isolucoes.com.br');
    assert.equal(result.headers['access-control-allow-credentials'], 'true');
  } finally {
    if (previousAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previousAllowedOrigins;
    if (previousAllowedOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previousAllowedOrigin;
  }
});

test('CORS preflight expõe todos os métodos operacionais do painel', () => {
  const result = response(204, {}, { headers: { origin: 'https://obrigacoes.e3isolucoes.com.br' } });
  assert.match(result.headers['access-control-allow-methods'], /GET/);
  assert.match(result.headers['access-control-allow-methods'], /POST/);
  assert.match(result.headers['access-control-allow-methods'], /PATCH/);
  assert.match(result.headers['access-control-allow-methods'], /DELETE/);
  assert.match(result.headers['access-control-allow-methods'], /OPTIONS/);
});
