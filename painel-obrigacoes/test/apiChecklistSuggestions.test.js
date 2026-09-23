import assert from 'node:assert/strict';
import test from 'node:test';
import { createChecklistSuggestions } from '../api/checklist-suggestions.js';

const awsEnv = { AWS_API_BASE_URL: 'https://api.aws.example', OPENAI_API_KEY: '' };
const legacyEnv = { ...awsEnv, ENABLE_SUPABASE_AUTH_FALLBACK: 'true', SUPABASE_URL: 'https://tenant.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' };

function request({ token, workspaceId = 'workspace-1', body = { obligation: { name: 'Obrigacao interna', category: 'outros' } }, contentLength, origin } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (workspaceId) headers.set('x-workspace-id', workspaceId);
  if (contentLength) headers.set('content-length', String(contentLength));
  if (origin) headers.set('origin', origin);
  return { method: 'POST', headers, json: async () => body };
}

const awsIdentity = (workspaceId = 'workspace-1') => ({ ok: true, status: 200, json: async () => ({ userId: 'user-1', workspaceId, role: 'member' }) });

test('Cognito válido é autorizado centralmente por /v1/me com o workspace solicitado', async () => {
  const calls = [];
  const handler = createChecklistSuggestions({
    env: awsEnv,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return awsIdentity(); },
  });
  const response = await handler(request({ token: 'cognito-token' }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.aws.example/v1/me');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer cognito-token');
  assert.equal(calls[0].options.headers['x-workspace-id'], 'workspace-1');
});

test('Supabase legado só é aceito quando o fallback explícito está habilitado e a RLS confirma membership', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (url.endsWith('/v1/me')) return { ok: false, status: 401 };
    if (url.endsWith('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'legacy-user' }) };
    return { ok: true, status: 200, json: async () => [{ id: 'legacy-user', workspace_id: 'workspace-1', active: true }] };
  };
  const enabled = await createChecklistSuggestions({ env: legacyEnv, fetchImpl })(request({ token: 'legacy-token' }));
  assert.equal(enabled.status, 200);
  assert.match(urls[2], /\/rest\/v1\/profiles\?/);
  assert.match(urls[2], /workspace_id=eq\.workspace-1/);

  const disabled = await createChecklistSuggestions({ env: awsEnv, fetchImpl })(request({ token: 'legacy-token' }));
  assert.equal(disabled.status, 401);
});

test('chamada sem token falha antes de consumir serviços externos', async () => {
  let fetchCalls = 0;
  const response = await createChecklistSuggestions({ fetchImpl: async () => { fetchCalls += 1; }, env: awsEnv })(request());
  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 0);
});

test('token inválido falha fechado', async () => {
  const response = await createChecklistSuggestions({ env: awsEnv, fetchImpl: async () => ({ ok: false, status: 401 }) })(request({ token: 'invalid' }));
  assert.equal(response.status, 401);
});

test('workspace inválido não pode usar fallback legado', async () => {
  let calls = 0;
  const response = await createChecklistSuggestions({ env: legacyEnv, fetchImpl: async () => { calls += 1; return { ok: false, status: 403 }; } })(request({ token: 'valid', workspaceId: 'not-a-member' }));
  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});

test('timeout da API AWS falha fechado sem consultar IA ou Supabase', async () => {
  let calls = 0;
  const response = await createChecklistSuggestions({
    env: legacyEnv,
    fetchImpl: async () => { calls += 1; throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
  })(request({ token: 'valid' }));
  assert.equal(response.status, 504);
  assert.equal(calls, 1);
});

test('OpenAI indisponível retorna fallback somente depois da autorização', async () => {
  const calls = [];
  const response = await createChecklistSuggestions({
    env: { ...awsEnv, OPENAI_API_KEY: 'backend-only-test-key' },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/v1/me')) return awsIdentity();
      return { ok: false, status: 503 };
    },
  })(request({ token: 'valid' }));
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.mode, 'Web + modelo operacional');
  assert.equal(response.jsonBody.suggestions.length, 6);
  assert.deepEqual(calls, ['https://api.aws.example/v1/me', 'https://api.openai.com/v1/responses']);
});

test('payload declarado acima do limite é rejeitado antes de ler o JSON', async () => {
  let bodyRead = false;
  const oversized = request({ token: 'valid', contentLength: 16 * 1024 + 1 });
  oversized.json = async () => { bodyRead = true; return {}; };
  const response = await createChecklistSuggestions({ env: awsEnv, fetchImpl: async () => awsIdentity() })(oversized);
  assert.equal(response.status, 413);
  assert.equal(bodyRead, false);
});

test('CORS só reflete origem permitida e inclui headers de segurança', async () => {
  const env = { ...awsEnv, ALLOWED_ORIGINS: 'https://app.example' };
  const denied = await createChecklistSuggestions({ env })(request({ token: 'valid', origin: 'https://evil.example' }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(denied.headers['Content-Security-Policy'], "default-src 'none'; frame-ancestors 'none'");

  const preflight = request({ origin: 'https://app.example' });
  preflight.method = 'OPTIONS';
  const allowed = await createChecklistSuggestions({ env })(preflight);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://app.example');
  assert.equal(allowed.headers['Access-Control-Allow-Headers'], 'authorization,content-type,x-workspace-id');
});
