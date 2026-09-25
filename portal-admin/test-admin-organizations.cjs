const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = process.env.E3I_ADMIN_DIR || __dirname;
const patchScript = process.env.E3I_ADMIN_ORGANIZATIONS_PATCH_SCRIPT || path.join(dir, 'patch-admin-organizations.cjs');
const snippetPath = process.env.E3I_ADMIN_ORGANIZATIONS_SNIPPET || path.join(dir, 'admin-organizations-server-snippet.txt');
const snippet = fs.readFileSync(snippetPath, 'utf8');

for (const marker of [
  'E3I_ADMIN_ORGANIZATIONS_PATCH_V1',
  "app.get('/api/admin/organizations'",
  "app.post('/api/admin/organizations'",
  "/api/admin/organizations/:organizationId/members/:userId",
  "/api/admin/organizations/:organizationId/activate",
  'canCreateOrganizations',
  'makeActive',
  'ROOT_ADMIN_REQUIRED',
]) assert.ok(snippet.includes(marker), `missing ${marker}`);

assert.doesNotMatch(snippet, /password|token\s*[:=]/i);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3i-admin-organizations-'));
const server = path.join(temp, 'server.cjs');
fs.writeFileSync(server, [
  'function validateSession(req,res){return req&&req.__auth?req.__auth:null;}',
  'const app={get(){},put(){},post(){},delete(){}};',
  'app.post("/api/auth/login", async (req, res) => { return res; });',
  'module.exports=app;',
  '',
].join('\n'));

for (let i = 0; i < 2; i += 1) {
  const result = spawnSync(process.execPath, [patchScript], {
    encoding: 'utf8',
    env: { ...process.env, E3I_PORTAL_SERVER: server, E3I_ADMIN_ORGANIZATIONS_SNIPPET: snippetPath },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
const patched = fs.readFileSync(server, 'utf8');
assert.equal((patched.match(/E3I_ADMIN_ORGANIZATIONS_PATCH_V1/g) || []).length, 1);
assert.equal(spawnSync(process.execPath, ['--check', server]).status, 0);
fs.rmSync(temp, { recursive: true, force: true });
console.log('PORTAL_ADMIN_ORGANIZATIONS_VALIDATION_OK');
