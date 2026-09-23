import { DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildItems, classifyExtras, contentHash, createManifest, diffManifests, keyOf, readJson, safeError, validateManifest, writeJson } from './manifest.mjs';
import { documentClient, entities, fetchAll, requiredEnv } from './shared.mjs';

function option(name, fallback) { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; }
function flag(name) { return process.argv.includes(name); }
const command = process.argv[2];
const commands = new Set(['plan', 'snapshot', 'apply', 'verify-content', 'verify-keys', 'verify-files', 'report']);
if (!commands.has(command)) throw new Error(`Comando inválido. Use: ${[...commands].join(', ')}`);
if (command === 'verify-files') { await import('./verify-files.mjs'); process.exit(); }

const config = requiredEnv();
const manifestPath = option('--manifest', `.migration/${command}.json`);
const previousPath = option('--previous');
const reportPath = option('--report', `.migration/reports/${command}.json`);
const client = await documentClient();

async function source() {
  const fetched = {};
  for (const entity of Object.keys(entities)) fetched[entity] = await fetchAll(config, entity);
  const built = buildItems(config, fetched);
  return { built, manifest: createManifest(config, built, command) };
}
async function targetItem(key) { return (await client.send(new GetCommand({ TableName: config.table, Key: key, ConsistentRead: true }))).Item; }
async function manifestFrom(path) { return validateManifest(await readJson(path), config); }
async function emit(report, failed = false) {
  await writeJson(reportPath, report); console.log(JSON.stringify(report, null, 2)); if (failed) process.exitCode = 2;
}

if (command === 'snapshot') {
  const { manifest } = await source(); await writeJson(manifestPath, manifest);
  const delta = previousPath ? diffManifests(await manifestFrom(previousPath), manifest) : null;
  await emit({ command, manifest: manifestPath, count: manifest.items.length, delta: delta && { inserts: delta.inserted.length, updates: delta.updated.length, deletes: delta.deleted.length } });
} else if (command === 'plan') {
  const { manifest } = await source(); const previous = previousPath ? await manifestFrom(previousPath) : { items: [] };
  const delta = diffManifests(previous, manifest);
  await emit({ command, inserts: delta.inserted.length, updates: delta.updated.length, deletes: delta.deleted.length, unchanged: delta.unchanged.length, deletionRequiresFlag: delta.deleted.length > 0 });
} else if (command === 'apply') {
  const expected = await manifestFrom(manifestPath); const { built, manifest: live } = await source();
  const drift = diffManifests(expected, live);
  if (drift.inserted.length || drift.updated.length || drift.deleted.length) {
    await emit({ command, status: 'FAIL', reason: 'source_changed_after_snapshot', inserts: drift.inserted.length, updates: drift.updated.length, deletes: drift.deleted.length }, true);
  } else {
    const previous = previousPath ? await manifestFrom(previousPath) : { items: [] };
    const previousByKey = new Map(previous.items.map((item) => [keyOf(item.targetKey), item]));
    const result = { command, status: 'PASS', inserted: 0, updated: 0, unchanged: 0, deleted: 0, conflicts: [] };
    for (const { item, manifest } of built) {
      const existing = await targetItem(manifest.targetKey);
      if (existing && contentHash(existing) === manifest.contentHash) {
        if (!existing.migrationContentHash) try { await client.send(new UpdateCommand({ TableName: config.table, Key: manifest.targetKey, UpdateExpression: 'SET migrationContentHash = :hash', ConditionExpression: 'attribute_not_exists(migrationContentHash)', ExpressionAttributeValues: { ':hash': manifest.contentHash } })); }
        catch (error) { result.conflicts.push({ targetKey: manifest.targetKey, reason: safeError(error).name }); continue; }
        result.unchanged++; continue;
      }
      const old = previousByKey.get(keyOf(manifest.targetKey));
      if (existing && (!old || contentHash(existing) !== old.contentHash)) { result.conflicts.push({ targetKey: manifest.targetKey, reason: 'target_modified' }); continue; }
      try {
        await client.send(new PutCommand({ TableName: config.table, Item: { ...item, migrationContentHash: manifest.contentHash }, ConditionExpression: existing ? 'migrationContentHash = :old' : 'attribute_not_exists(PK) AND attribute_not_exists(SK)', ExpressionAttributeValues: existing ? { ':old': old.contentHash } : undefined }));
        existing ? result.updated++ : result.inserted++;
      } catch (error) { result.conflicts.push({ targetKey: manifest.targetKey, reason: safeError(error).name }); }
    }
    const delta = diffManifests(previous, expected);
    result.deletionCandidates = delta.deleted;
    if (delta.deleted.length && !flag('--apply-deletes')) result.conflicts.push(...delta.deleted.map((item) => ({ targetKey: item.targetKey, reason: 'deletion_requires_explicit_flag' })));
    if (flag('--apply-deletes')) for (const removed of delta.deleted) {
      const existing = await targetItem(removed.targetKey);
      if (!existing) continue;
      if (contentHash(existing) !== removed.contentHash) { result.conflicts.push({ targetKey: removed.targetKey, reason: 'target_modified_before_delete' }); continue; }
      try { await client.send(new DeleteCommand({ TableName: config.table, Key: removed.targetKey, ConditionExpression: 'migrationContentHash = :old', ExpressionAttributeValues: { ':old': removed.contentHash } })); result.deleted++; }
      catch (error) { result.conflicts.push({ targetKey: removed.targetKey, reason: safeError(error).name }); }
    }
    if (result.conflicts.length) result.status = 'FAIL'; await emit(result, result.status === 'FAIL');
  }
} else if (command === 'verify-content') {
  const manifest = await manifestFrom(manifestPath); const mismatches = [];
  for (const expected of manifest.items) { const item = await targetItem(expected.targetKey); if (!item || contentHash(item) !== expected.contentHash) mismatches.push({ targetKey: expected.targetKey, reason: item ? 'content_mismatch' : 'missing' }); }
  await emit({ command, status: mismatches.length ? 'FAIL' : 'PASS', checked: manifest.items.length, mismatches }, mismatches.length > 0);
} else if (command === 'verify-keys') {
  const manifest = await manifestFrom(manifestPath); const expected = new Set(manifest.items.map((item) => keyOf(item.targetKey))); const actual = new Set(); let ExclusiveStartKey;
  const scope = `TOOL#${config.toolId}#ENV#${config.appEnv}#`;
  do { const page = await client.send(new ScanCommand({ TableName: config.table, ProjectionExpression: 'PK, SK', FilterExpression: 'begins_with(PK, :scope)', ExpressionAttributeValues: { ':scope': scope }, ExclusiveStartKey })); for (const item of page.Items || []) actual.add(keyOf(item)); ExclusiveStartKey = page.LastEvaluatedKey; } while (ExclusiveStartKey);
  const missing = [...expected].filter((key) => !actual.has(key)); const extras = [...actual].filter((key) => !expected.has(key));
  const allow = option('--extras-allowlist') ? (await readJson(option('--extras-allowlist'))).keys : []; const classifiedExtras = classifyExtras(extras, allow); const unapprovedExtras = classifiedExtras.filter((item) => item.classification === 'unapproved');
  const fail = missing.length > 0 || (flag('--cutover') && unapprovedExtras.length > 0);
  await emit({ command, status: fail ? 'FAIL' : 'PASS', missing: missing.length, extras: classifiedExtras, approvedExtras: extras.length - unapprovedExtras.length, unapprovedExtras: unapprovedExtras.length, cutover: flag('--cutover') }, fail);
} else if (command === 'report') {
  const manifest = await manifestFrom(manifestPath); const byEntity = {};
  for (const item of manifest.items) byEntity[item.entity] = (byEntity[item.entity] || 0) + 1;
  await emit({ command, status: 'INFO', executionId: manifest.executionId, manifest: manifestPath, total: manifest.items.length, byEntity });
}
