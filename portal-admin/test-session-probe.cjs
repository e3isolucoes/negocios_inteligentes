const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3i-session-probe-'));
const server = path.join(dir, 'server.cjs');
fs.writeFileSync(server, [
  'const express = require("express");',
  'const app = express();',
  'app.get("/api/auth/session", (req, res) => {',
  '  return res.status(401).json({ error: "No active session" });',
  '});',
].join('\n'));

execFileSync(process.execPath, [path.join(__dirname, 'patch-session-probe.cjs')], {
  env: { ...process.env, E3I_PORTAL_SERVER: server },
  stdio: 'pipe',
});

const patched = fs.readFileSync(server, 'utf8');
assert.match(patched, /E3I_ANONYMOUS_SESSION_PROBE_V2/);
assert.match(patched, /req\.path !== "\/api\/auth\/session"/);
assert.match(patched, /Number\(code\) === 401/);
assert.match(patched, /originalSend/);
assert.match(patched, /originalEnd/);
assert.match(patched, /authenticated: false, user: null, session: null/);

console.log('E3I_PORTAL_AUTH_SESSION_PROBE_TEST_OK');
