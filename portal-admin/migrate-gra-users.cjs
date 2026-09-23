const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.PORTAL_DATA_FILE || '/app/data/bigquery_dataset.json';
const TARGETS = [
  { id: '2383d4c1-f0e7-4284-8c45-335e1a80afd7', email: 'fiscal@gracomercio.com.br', name: 'Wagner' },
  { id: '5a1fe7ff-bfe5-4000-833a-5f532d8bdca5', email: 'nfe@gracomercio.com.br', name: 'Michele' },
  { id: 'a1dcc1ef-859f-4e66-b4ac-55c70ed22bec', email: 'fiscal2@gracomercio.com.br', name: 'Carol' },
  { id: 'f8977e6f-f38c-4968-9ac4-61c31bf605dd', email: 'samea@gracomercio.com.br', name: 'Samea' },
  { id: '190ef281-def8-41da-aeb7-0d29d9a6c30d', email: 'marcomirandacoc@gmail.com', name: 'Marco Antonio Miranda' },
  { id: '381b1106-b1a1-4cdd-a513-c69e25688425', email: 'marcoantoniomiranda713@gmail.com', name: 'Marco Antonio Miranda' },
  { id: 'bd05a0d4-74e3-419b-9585-16f403a6e5c3', email: 'daniela@gracomercio.com.br', name: 'Daniela Estoque Miranda' },
];

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function durableWrite(file, content, flags = 'w') {
  const descriptor = fs.openSync(file, flags, 0o600);
  try {
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    durableWrite(temporary, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

if (!fs.existsSync(DATA_FILE)) {
  console.error(`PORTAL_USER_RECONCILIATION_FAILED data file missing: ${DATA_FILE}`);
  process.exit(2);
}

const sourceContents = fs.readFileSync(DATA_FILE, 'utf8');
const dataset = JSON.parse(sourceContents);
const tables = dataset?.tables;
const users = tables?.users?.data;
const memberships = tables?.organization_memberships?.data;
const tenants = tables?.tenants?.data;

if (!Array.isArray(users) || !Array.isArray(memberships) || !Array.isArray(tenants)) {
  console.error('PORTAL_USER_RECONCILIATION_FAILED required tables are missing');
  process.exit(3);
}

const daniela = users.find((user) => normalized(user.email) === 'daniela@gracomercio.com.br');
if (!daniela) {
  console.error('PORTAL_USER_RECONCILIATION_FAILED Daniela template user not found');
  process.exit(4);
}

const danielaMembership = memberships.find(
  (membership) => membership.userId === daniela.id && membership.status === 'ACTIVE',
);
const organizationId = danielaMembership?.organizationId
  || daniela.tenantId
  || tenants.find((tenant) => /gra\s*com/i.test(`${tenant.tradeName || ''} ${tenant.legalName || ''}`))?.id;

if (!organizationId) {
  console.error('PORTAL_USER_RECONCILIATION_FAILED GRA organization could not be resolved');
  process.exit(5);
}

const organization = tenants.find((tenant) => tenant.id === organizationId);
if (!organization || organization.status !== 'ACTIVE') {
  console.error('PORTAL_USER_RECONCILIATION_FAILED GRA organization is missing or inactive');
  process.exit(6);
}

const membershipRole = danielaMembership?.role || daniela.systemRole || daniela.role || 'OPERATOR';
let changed = false;
const now = new Date().toISOString();

for (const target of TARGETS) {
  let user = users.find((candidate) => normalized(candidate.email) === normalized(target.email));

  if (!user) {
    user = {
      id: target.id,
      name: target.name,
      email: target.email,
      passwordHash: '',
      status: 'ACTIVE',
      role: 'OPERATOR',
      systemRole: 'OPERATOR',
      tenantId: organizationId,
      createdAt: now,
      mustChangePassword: true,
      passwordOnboardingVersion: 0,
    };
    users.push(user);
    changed = true;
    console.log(`PORTAL_USER_CREATED ${target.email}`);
  } else {
    const before = JSON.stringify(user);
    user.email = target.email;
    user.name = user.name || target.name;
    user.status = 'ACTIVE';
    user.tenantId = organizationId;
    user.role = user.role || user.systemRole || 'OPERATOR';
    user.systemRole = user.systemRole || user.role || 'OPERATOR';
    if (Number(user.passwordOnboardingVersion || 0) < 1) {
      user.mustChangePassword = true;
    }
    if (JSON.stringify(user) !== before) {
      changed = true;
      console.log(`PORTAL_USER_RECONCILED ${target.email}`);
    }
  }

  const activeMembership = memberships.find(
    (membership) => membership.userId === user.id
      && membership.organizationId === organizationId
      && membership.status === 'ACTIVE',
  );

  if (!activeMembership) {
    memberships.push({
      id: `mem-migrated-${user.id}`,
      userId: user.id,
      organizationId,
      role: membershipRole,
      status: 'ACTIVE',
      joinedAt: now,
    });
    changed = true;
    console.log(`PORTAL_MEMBERSHIP_CREATED ${target.email}`);
  }
}

const memberIds = new Set(
  memberships
    .filter((membership) => membership.organizationId === organizationId && membership.status === 'ACTIVE')
    .map((membership) => membership.userId),
);
if (organization.usersCount !== memberIds.size) {
  organization.usersCount = memberIds.size;
  changed = true;
}

if (changed) {
  const backup = path.join(
    path.dirname(DATA_FILE),
    `bigquery_dataset.json.before-first-login-${Date.now()}`,
  );

  // Azure Files pode retornar EPERM para copyFile/copy_file_range. Grave o snapshot
  // pelos syscalls comuns de open/write/fsync, que são suportados pelo mesmo volume.
  durableWrite(backup, sourceContents, 'wx');
  console.log(`PORTAL_USER_BACKUP_OK ${backup}`);

  dataset.lastSyncAt = now;
  tables.users.rowsCount = users.length;
  tables.organization_memberships.rowsCount = memberships.length;
  atomicWrite(DATA_FILE, dataset);
  console.log(`PORTAL_USER_RECONCILIATION_OK organization=${organizationId} users=${TARGETS.length}`);
} else {
  console.log(`PORTAL_USER_RECONCILIATION_NOOP organization=${organizationId} users=${TARGETS.length}`);
}
