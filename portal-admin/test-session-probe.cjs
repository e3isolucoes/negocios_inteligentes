const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const middleware = require('./session-probe-middleware.cjs');

function createResponse() {
  const result = { body: undefined, ended: false };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = Number(code); return this; },
    json(payload) { result.body = payload; result.ended = true; return this; },
    send(payload) { result.body = payload; result.ended = true; return this; },
    end(payload) { result.body = payload; result.ended = true; return this; },
    writeHead(code) { this.statusCode = Number(code); return this; },
  };
  return { res, result };
}

function runScenario(route, req = { method: 'GET', path: '/api/auth/session' }) {
  const { res, result } = createResponse();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  route(res);
  return { res, result };
}

{
  const { res, result } = runScenario((res) => res.status(401).json({ error: 'Sessão não autenticada.' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(result.body, { authenticated: false, user: null, session: null });
}

{
  const { res, result } = runScenario((res) => {
    res.statusCode = 401;
    return res.send({ error: 'Sessão não autenticada.' });
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(result.body, { authenticated: false, user: null, session: null });
}

{
  const { res, result } = runScenario((res) => res.status(403).json({ error: 'Proibido.' }));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(result.body, { error: 'Proibido.' });
}

{
  const { res, result } = runScenario((res) => res.status(200).json({ authenticated: true, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(result.body.authenticated, true);
}

{
  const { res, result } = runScenario(
    (res) => res.status(401).json({ error: 'Nope' }),
    { method: 'GET', path: '/api/auth/session/child' },
  );
  assert.equal(res.statusCode, 401);
  assert.deepEqual(result.body, { error: 'Nope' });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3i-session-probe-'));
const server = path.join(dir, 'server.cjs');
fs.writeFileSync(server, [
  'const express = require("express");',
  'const app = express();',
  'app.get("/api/auth/session", (req, res) => {',
  '  res.statusCode = 401;',
  '  return res.json({ error: "Sessão não autenticada." });',
  '});',
].join('\n'));

execFileSync(process.execPath, [path.join(__dirname, 'patch-session-probe.cjs')], {
  env: { ...process.env, E3I_PORTAL_SERVER: server },
  stdio: 'pipe',
});

const patched = fs.readFileSync(server, 'utf8');
assert.match(patched, /E3I_ANONYMOUS_SESSION_PROBE_V3/);
assert.match(patched, /require\("\.\/session-probe-middleware\.cjs"\)/);
assert.ok(
  patched.indexOf('E3I_ANONYMOUS_SESSION_PROBE_V3')
    < patched.indexOf('app.get("/api/auth/session"'),
);

console.log('E3I_PORTAL_AUTH_SESSION_PROBE_TEST_OK');
