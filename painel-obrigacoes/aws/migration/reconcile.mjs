import { administrationPk, countPrefix, documentClient, enrichRows, entities, fetchAll, membershipPk, requiredEnv, tenantPk } from './shared.mjs';

const config = requiredEnv(); const client = await documentClient();
const fetched = {};
for (const entity of Object.keys(entities)) fetched[entity] = await fetchAll(config, entity);
const allRows = enrichRows(fetched);
const workspaces = allRows.workspaces;
const report = { checkedAt: new Date().toISOString(), workspaces: {}, matches: true };
for (const workspace of workspaces) {
  const workspaceResult = {};
  for (const [entity, prefix] of Object.entries(entities)) {
    const source = allRows[entity].filter((row) => (row.workspace_id || row.id) === workspace.id).length;
    const target = await countPrefix(client, config.table, tenantPk(config, workspace.id), prefix);
    workspaceResult[entity] = { source, target, match: source === target };
    if (source !== target) report.matches = false;
  }
  report.workspaces[workspace.id] = workspaceResult;
}

const profilesWithWorkspace = allRows.profiles.filter((profile) => profile.workspace_id);
let membershipTarget = 0;
for (const profile of profilesWithWorkspace) {
  membershipTarget += await countPrefix(client, config.table, membershipPk(config, profile.id), 'MEMBERSHIP');
}
report.memberships = {
  source: profilesWithWorkspace.length,
  target: membershipTarget,
  match: profilesWithWorkspace.length === membershipTarget
};

const administrativeProfiles = allRows.profiles.filter((profile) => !profile.workspace_id && profile.role === 'super_admin');
const administrativeTarget = await countPrefix(client, config.table, administrationPk(config), 'PROFILE');
report.administration = {
  source: administrativeProfiles.length,
  target: administrativeTarget,
  match: administrativeProfiles.length === administrativeTarget
};
const administrativeWorkspacesTarget = await countPrefix(client, config.table, administrationPk(config), 'WORKSPACE');
report.administrativeWorkspaces = {
  source: workspaces.length,
  target: administrativeWorkspacesTarget,
  match: workspaces.length === administrativeWorkspacesTarget
};

if (!report.memberships.match || !report.administration.match || !report.administrativeWorkspaces.match) report.matches = false;
console.log(JSON.stringify(report, null, 2));
if (!report.matches) process.exitCode = 2;
