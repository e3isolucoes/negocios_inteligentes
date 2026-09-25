const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
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
  'e3iAdminOrganizationsSyncLiveContext',
]) assert.ok(snippet.includes(marker), `missing ${marker}`);

assert.doesNotMatch(snippet, /passwordHash|refreshToken|accessToken/);

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

const dataFile = path.join(temp, 'dataset.json');
const rootEmail = 'admin@e3isolucoes.com.br';
const dataset = {
  tables: {
    users: {
      data: [
        { id: 'root', name: 'Admin raiz', email: rootEmail, role: 'E3I_ADMIN', systemRole: 'E3I_ADMIN', status: 'ACTIVE', tenantId: 'org-a' },
        { id: 'delegated', name: 'Admin delegado', email: 'delegated@example.com', role: 'E3I_ADMIN', systemRole: 'E3I_ADMIN', adminCentralGrantedBy: rootEmail, status: 'ACTIVE', tenantId: 'org-a' },
        { id: 'operator', name: 'Operador', email: 'operator@example.com', role: 'OPERATOR', systemRole: 'OPERATOR', status: 'ACTIVE', tenantId: 'org-b' },
      ],
      rowsCount: 3,
    },
    tenants: {
      data: [
        { id: 'org-a', legalName: 'Empresa A Ltda', tradeName: 'Empresa A', status: 'ACTIVE' },
        { id: 'org-b', legalName: 'Empresa B Ltda', tradeName: 'Empresa B', status: 'ACTIVE' },
      ],
      rowsCount: 2,
    },
    organization_memberships: {
      data: [
        { id: 'm-root', userId: 'root', organizationId: 'org-a', role: 'ADMIN', status: 'ACTIVE' },
        { id: 'm-delegated', userId: 'delegated', organizationId: 'org-a', role: 'ADMIN', status: 'ACTIVE' },
        { id: 'm-operator', userId: 'operator', organizationId: 'org-b', role: 'MEMBER', status: 'ACTIVE' },
      ],
      rowsCount: 3,
    },
  },
};
fs.writeFileSync(dataFile, JSON.stringify(dataset));

const routes = [];
const app = {
  get(route, handler) { routes.push(['GET', route, handler]); },
  post(route, handler) { routes.push(['POST', route, handler]); },
  put(route, handler) { routes.push(['PUT', route, handler]); },
  delete(route, handler) { routes.push(['DELETE', route, handler]); },
};
const users = dataset.tables.users.data.map((item) => ({ ...item }));
const sessions = [
  { id: 'session-root', userId: 'root', organizationId: 'org-a', user: { id: 'root', organizationId: 'org-a' } },
  { id: 'session-operator', userId: 'operator', organizationId: 'org-b', user: { id: 'operator', organizationId: 'org-b' } },
];
const context = {
  app,
  users,
  sessions,
  validateSession(req, res) { return req.__auth || (res.status(401).json({}), null); },
  require,
  process: { ...process, env: { ...process.env, E3I_PORTAL_DATA_FILE: dataFile, E3I_ROOT_ADMIN_EMAIL: rootEmail } },
  console,
};
vm.createContext(context);
vm.runInContext(snippet, context);

const route = (method, suffix) => {
  const found = routes.find(([m, p]) => m === method && p.endsWith(suffix));
  assert.ok(found, `missing route ${method} ${suffix}`);
  return found[2];
};
const response = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  set(key, value) { this.headers[key] = value; return this; },
});
const request = (auth, params = {}, body = {}) => ({
  __auth: auth,
  params,
  body,
  get(name) { return name.toLowerCase() === 'x-e3i-admin-request' ? '1' : ''; },
});

const rootAuth = { userId: 'root', email: rootEmail, organizationId: 'org-a' };
const delegatedAuth = { userId: 'delegated', email: 'delegated@example.com', organizationId: 'org-a' };

let res = response();
route('GET', '/api/admin/organizations')(request(rootAuth), res);
assert.equal(res.statusCode, 200);
assert.equal(res.body.organizations.length, 2);
assert.equal(res.body.activeOrganizationId, 'org-a');
assert.equal(res.body.permissions.canCreateOrganizations, true);

res = response();
route('GET', '/api/admin/organizations')(request(delegatedAuth), res);
assert.equal(res.statusCode, 200);
assert.deepEqual(Array.from(res.body.organizations, (item) => item.id), ['org-a']);
assert.equal(res.body.permissions.canCreateOrganizations, false);

res = response();
route('POST', '/api/admin/organizations')(request(delegatedAuth, {}, { legalName: 'Negada Ltda', tradeName: 'Negada' }), res);
assert.equal(res.statusCode, 403);
assert.equal(res.body.code, 'ROOT_ADMIN_REQUIRED');

res = response();
route('POST', '/api/admin/organizations')(request(rootAuth, {}, { legalName: 'Empresa C Ltda', tradeName: 'Empresa C', document: '12345678000199' }), res);
assert.equal(res.statusCode, 201);
const orgC = res.body.organization.id;
assert.match(orgC, /^org-empresa-c-/);

res = response();
route('PUT', '/members/:userId')(request(rootAuth, { organizationId: 'org-a', userId: 'operator' }, { makeActive: true }), res);
assert.equal(res.statusCode, 200);
assert.equal(res.body.activeOrganizationId, 'org-a');
let persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
assert.equal(persisted.tables.users.data.find((item) => item.id === 'operator').tenantId, 'org-a');
assert.ok(persisted.tables.organization_memberships.data.some((item) => item.userId === 'operator' && item.organizationId === 'org-a' && item.status === 'ACTIVE'));
assert.equal(users.find((item) => item.id === 'operator').organizationId, 'org-a');
assert.equal(sessions.find((item) => item.userId === 'operator').organizationId, 'org-a');

res = response();
route('POST', '/:organizationId/activate')(request(rootAuth, { organizationId: 'org-b' }), res);
assert.equal(res.statusCode, 200);
assert.equal(res.body.activeOrganizationId, 'org-b');
persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
assert.equal(persisted.tables.users.data.find((item) => item.id === 'root').tenantId, 'org-b');
assert.equal(users.find((item) => item.id === 'root').organizationId, 'org-b');
assert.equal(sessions.find((item) => item.userId === 'root').organizationId, 'org-b');
assert.equal(sessions.find((item) => item.userId === 'root').user.organizationId, 'org-b');

fs.rmSync(temp, { recursive: true, force: true });
console.log('PORTAL_ADMIN_ORGANIZATIONS_VALIDATION_OK');
