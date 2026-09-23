import { S3Client } from '@aws-sdk/client-s3';
import { fetchAll, requiredEnv } from './shared.mjs';
import { assertSecureBucket, buildInventory, migrateReference } from './file-integrity.mjs';

const execute = process.argv.includes('--execute');
const config = requiredEnv();
const bucket = process.env.FILES_BUCKET;
if (!bucket) throw new Error('FILES_BUCKET ausente.');
const s3 = new S3Client({});
const completions = await fetchAll(config, 'completions');
const inventory = buildInventory(config, completions);
const report = { mode: execute ? 'execute' : 'dry-run', startedAt: new Date().toISOString(), total_source: inventory.references.length, planned: inventory.references.length, copied: 0, verified: 0, missing: 0, mismatch: inventory.invalid.length, orphaned: 0, failed: [...inventory.invalid] };

if (!execute) {
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

await assertSecureBucket(s3, bucket);
for (const reference of inventory.references) {
  try {
    const result = await migrateReference({ s3, bucket, config, reference });
    report[result.status] += 1;
  } catch (error) {
    error.code === 'SOURCE_MISSING' ? report.missing++ : report.mismatch++;
    report.failed.push({ completionId: reference.completionId, targetPath: reference.targetPath, reason: error.code || 'migration_error', error: error.message });
  }
}
report.finishedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
if (report.failed.length) process.exitCode = 2;
