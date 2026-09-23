import assert from 'node:assert/strict';
import test from 'node:test';
import { errorResponse, handleAuthenticatedRequest, handler } from '../src/handler.mjs';

const auth = { workspaceId: 'empresa-a', userId: 'user-a', role: 'member', email: 'user@empresa.test' };

function event(method, path) {
  return {
    rawPath: `/v1/${path}`,
    headers: {},
    requestContext: { requestId: 'request-a', http: { method } }
  };
}

test('refresh sem cookie representa sessão ausente sem gerar falso erro 401', async () => {
  const result = await handler(event('POST', 'session/refresh'));

  assert.equal(result.statusCode, 204);
  assert.equal(result.body, '');
});

test('GET inexistente preserva o erro 404 do repositório', async () => {
  const repository = {
    get: async receivedAuth => {
      assert.equal(receivedAuth.workspaceId, 'empresa-a');
      throw Object.assign(new Error('Registro não encontrado.'), { statusCode: 404 });
    }
  };

  const result = await handleAuthenticatedRequest(event('GET', 'obligations/missing'), auth, { repository });

  assert.equal(result.statusCode, 404);
  assert.deepEqual(JSON.parse(result.body), { error: 'Registro não encontrado.', code: 'REQUEST_REJECTED', requestId: 'request-a' });
});

test('falha de serviço AWS retorna JSON 502 rastreável sem expor detalhes internos', () => {
  const originalConsoleError = console.error;
  const logs = [];
  console.error = value => logs.push(JSON.parse(value));
  try {
    const error = Object.assign(new Error('mensagem sensível do provedor'), {
      name: 'ServiceUnavailableException',
      $metadata: { requestId: 'aws-request-1', httpStatusCode: 503 },
    });

    const result = errorResponse(error, event('POST', 'internal/portal-access'), 'request-a');

    assert.equal(result.statusCode, 502);
    assert.match(result.headers['content-type'], /application\/json/);
    assert.deepEqual(JSON.parse(result.body), {
      error: 'Erro interno.', code: 'UPSTREAM_SERVICE_ERROR', requestId: 'request-a',
    });
    assert.deepEqual(logs, [{
      level: 'error', requestId: 'request-a', method: 'POST', path: '/v1/internal/portal-access',
      status: 502, code: 'UPSTREAM_SERVICE_ERROR', name: 'ServiceUnavailableException',
      upstreamRequestId: 'aws-request-1', upstreamStatus: 503, message: 'internal_error',
    }]);
  } finally {
    console.error = originalConsoleError;
  }
});

test('DELETE inexistente responde 204 conforme contrato idempotente', async () => {
  const repository = {
    remove: async receivedAuth => {
      assert.equal(receivedAuth.workspaceId, 'empresa-a');
      return null;
    }
  };

  const result = await handleAuthenticatedRequest(event('DELETE', 'obligations/missing'), auth, { repository });

  assert.equal(result.statusCode, 204);
  assert.equal(result.body, '');
});

test('handler repassa somente o workspace autenticado ao repositório', async () => {
  const calls = [];
  const repository = {
    get: async receivedAuth => {
      calls.push(receivedAuth.workspaceId);
      return { id: 'shared-id', workspace_id: receivedAuth.workspaceId };
    }
  };

  const result = await handleAuthenticatedRequest(
    event('GET', 'obligations/shared-id'),
    { ...auth, workspaceId: 'empresa-b' },
    { repository }
  );

  assert.deepEqual(calls, ['empresa-b']);
  assert.equal(JSON.parse(result.body).workspace_id, 'empresa-b');
});
