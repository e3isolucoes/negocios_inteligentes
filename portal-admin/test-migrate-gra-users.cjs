const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3i-existing-users-'));
const dataFile = path.join(dir, 'bigquery_dataset.json');
const organizationId = 'org-gra';

const dataset = {
  tables: {
    users: {
      data: [{
        id: 'daniela-existing',
        name: 'Daniela Estoque Miranda',
        email: 'daniela@gracomercio.com.br',
        status: 'ACTIVE',
        role: 'OPERATOR',
        systemRole: 'OPERATOR',
        tenantId: organizationId,
      }],
      rowsCount: 1,
    },
    organization_memberships: {
      data: [{
        id: 'mem-daniela',
        userId: 'daniela-existing',
        organizationId,
        role: 'MEMBER',
        status: 'ACTIVE',
      }],
      rowsCount: 1,
    },
    tenants: {
      data: [{
        id: organizationId,
        legalName: 'GRA Comercio',
        tradeName: 'GRA Comercio',
        status: 'ACTIVE',
      }],
      rowsCount: 1,
    },
  },
};

fs.writeFileSync(dataFile, JSON.stringify(dataset));

const migration = path.join(__dirname, 'migrate-gra-users.cjs');
const first = spawnSync(process.execPath, [migration], {
  env: { ...process.env, PORTAL_DATA_FILE: dataFile },
  encoding: 'utf8',
});
assert.equal(first.status, 0, first.stderr || first.stdout);

const migrated = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const users = migrated.tables.users.data;
const memberships = migrated.tables.organization_memberships.data;

const expectedEmails = [
  'fiscal@gracomercio.com.br',
  'nfe@gracomercio.com.br',
  'fiscal2@gracomercio.com.br',
  'samea@gracomercio.com.br',
  'marcomirandacoc@gmail.com',
  'marcoantoniomiranda713@gmail.com',
  'daniela@gracomercio.com.br',
];

for (const email of expectedEmails) {
  const user = users.find((item) => String(item.email).toLowerCase() === email);
  assert.ok(user, `missing reconciled user ${email}`);
  assert.equal(user.tenantId, organizationId);
  assert.ok(
    memberships.some((membership) =>
      membership.userId === user.id
      && membership.organizationId === organizationId
      && membership.status === 'ACTIVE'
    ),
    `missing active membership for ${email}`,
  );
}

assert.equal(new Set(users.map((user) => String(user.email).toLowerCase())).size, users.length);

const second = spawnSync(process.execPath, [migration], {
  env: { ...process.env, PORTAL_DATA_FILE: dataFile },
  encoding: 'utf8',
});
assert.equal(second.status, 0, second.stderr || second.stdout);

const rerun = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
assert.equal(rerun.tables.users.data.length, users.length);
assert.equal(rerun.tables.organization_memberships.data.length, memberships.length);

fs.rmSync(dir, { recursive: true, force: true });
console.log('PORTAL_EXISTING_USERS_RECONCILIATION_OK');
