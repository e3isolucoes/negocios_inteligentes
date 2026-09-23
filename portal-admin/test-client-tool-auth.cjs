const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3i-client-tool-auth-'));
const index = path.join(dir, 'index.html');
fs.writeFileSync(index, '<!doctype html><html><head><script type="module" src="/assets/app.js"></script></head><body></body></html>');

const patch = path.join(__dirname, 'patch-client-tool-auth.cjs');
for (let i = 0; i < 2; i += 1) {
  execFileSync(process.execPath, [patch], {
    env: { ...process.env, E3I_PORTAL_INDEX: index },
    stdio: 'pipe',
  });
}

const patched = fs.readFileSync(index, 'utf8');
const tag = '<script src="/client-tool-auth.js"></script>';
assert.equal((patched.match(/client-tool-auth\.js/g) || []).length, 1);
assert.ok(patched.indexOf(tag) < patched.indexOf('/assets/app.js'));

const bridge = fs.readFileSync(path.join(__dirname, 'client-tool-auth.js'), 'utf8');
assert.match(bridge, /E3I_CLIENT_TOOL_AUTH_BRIDGE_V1/);
assert.match(bridge, /\/api\/client-tools/);
assert.match(bridge, /credentials = 'same-origin'/);
assert.match(bridge, /sessionAuthMode === 'cookie'/);
assert.match(bridge, /response\.status === 401/);

console.log('E3I_CLIENT_TOOL_AUTH_TEST_OK');
