import { S3Client } from '@aws-sdk/client-s3';
import { fetchAll, requiredEnv } from './shared.mjs';
import { writeJson } from './manifest.mjs';
import { assertSecureBucket, buildInventory, classifyOrphans, compareObject, fetchSourceObject, isNotFound, listS3Objects, listSupabaseObjects, readS3Object } from './file-integrity.mjs';

const config = requiredEnv();
const bucket = process.env.FILES_BUCKET;
if (!bucket) throw new Error('FILES_BUCKET ausente.');
const s3 = new S3Client({});
const completions = await fetchAll(config, 'completions');
const inventory = buildInventory(config, completions);
const prefix = `${config.toolId}/${config.appEnv}/`;
const report = {
  checkedAt: new Date().toISOString(), total_source: 0, total_target: 0, referenced: inventory.references.length,
  verified: 0, missing: 0, mismatch: inventory.invalid.length, orphaned: 0,
  inventory: inventory.references.map((item) => ({ ...item, status: 'pending' })),
  failures: [...inventory.invalid], orphans: { source: [], target: [] }
};

try { report.bucket = await assertSecureBucket(s3, bucket); }
catch (error) { report.mismatch++; report.failures.push({ reason: 'insecure_bucket', error: error.message }); }

let sourceObjects = [], targetObjects = [];
try { sourceObjects = await listSupabaseObjects(config); report.total_source = sourceObjects.length; }
catch (error) { report.mismatch++; report.failures.push({ reason: 'source_inventory_failed', error: error.message }); }
try { targetObjects = await listS3Objects(s3, bucket, prefix); report.total_target = targetObjects.length; }
catch (error) { report.mismatch++; report.failures.push({ reason: 'target_inventory_failed', error: error.message }); }

const orphans = classifyOrphans(sourceObjects, inventory.references, targetObjects);
report.orphans = { source: orphans.sourceOrphans, target: orphans.targetOrphans };
report.orphaned = orphans.sourceOrphans.length;
report.orphaned_target = orphans.targetOrphans.length;

for (const reference of inventory.references) {
  const inventoryEntry = report.inventory.find((item) => item.completionId === reference.completionId && item.targetPath === reference.targetPath);
  try {
    const source = await fetchSourceObject(config, reference.sourcePath);
    const target = await readS3Object(s3, bucket, reference.targetPath);
    const differences = compareObject(reference, source, target);
    if (differences.length) {
      report.mismatch++; report.failures.push({ completionId: reference.completionId, sourcePath: reference.sourcePath, targetPath: reference.targetPath, reason: 'integrity_mismatch', differences });
      inventoryEntry.status = 'mismatch';
    } else { report.verified++; inventoryEntry.status = 'verified'; }
  } catch (error) {
    if (error.code === 'SOURCE_MISSING' || isNotFound(error)) report.missing++; else report.mismatch++;
    inventoryEntry.status = error.code === 'SOURCE_MISSING' || isNotFound(error) ? 'missing' : 'mismatch';
    report.failures.push({ completionId: reference.completionId, sourcePath: reference.sourcePath, targetPath: reference.targetPath, reason: error.code || (isNotFound(error) ? 'target_missing' : 'verification_error'), error: error.message });
  }
}

report.all_completion_paths_resolvable = report.verified === inventory.references.length && inventory.invalid.length === 0;
report.cutover = report.missing === 0 && report.mismatch === 0 && report.all_completion_paths_resolvable ? 'PASS' : 'FAIL';
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0 && process.argv[reportIndex + 1]) await writeJson(process.argv[reportIndex + 1], report);
console.log(JSON.stringify(report, null, 2));
if (report.cutover !== 'PASS') process.exitCode = 2;
