import { createHash } from 'node:crypto';
import {
  GetBucketEncryptionCommand, GetPublicAccessBlockCommand, GetBucketVersioningCommand,
  GetObjectCommand, ListObjectsV2Command, PutObjectCommand
} from '@aws-sdk/client-s3';

export function cleanSourcePath(value) {
  const path = String(value || '').replace(/^\/+/, '');
  if (!path || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return path;
}

export function targetKey(config, completion) {
  return `${config.toolId}/${config.appEnv}/${completion.workspace_id}/legacy/${cleanSourcePath(completion.attachment_path)}`;
}

function safeSegment(value) {
  const segment = String(value || '');
  return segment && segment !== '.' && segment !== '..' && !segment.includes('/') && !segment.includes('\\') && !/[\u0000-\u001f\u007f]/.test(segment);
}

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function normalizeContentType(value) { return value ? String(value).split(';', 1)[0].trim().toLowerCase() : null; }

export async function withRetry(operation, { attempts = 3, delay = (attempt) => new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt))) } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      const status = error?.$metadata?.httpStatusCode || error?.status;
      if (attempt === attempts - 1 || (status && status < 500 && status !== 429)) throw error;
      await delay(attempt);
    }
  }
  throw lastError;
}

export function buildInventory(config, completions) {
  if (!safeSegment(config.toolId) || !safeSegment(config.appEnv)) throw new Error('TOOL_ID ou APP_ENV inválido para namespace S3');
  const invalid = [], references = [], keys = new Map();
  for (const row of completions.filter((item) => item.attachment_path)) {
    const sourcePath = cleanSourcePath(row.attachment_path);
    if (!safeSegment(row.id) || !safeSegment(row.workspace_id) || !sourcePath) {
      invalid.push({ completionId: row.id || null, sourcePath, reason: 'invalid_completion_reference' });
      continue;
    }
    const reference = { completionId: String(row.id), workspace: String(row.workspace_id), sourcePath, targetPath: targetKey(config, row) };
    references.push(reference);
    const previous = keys.get(reference.targetPath);
    if (previous && previous.completionId !== reference.completionId) {
      invalid.push({ completionId: reference.completionId, sourcePath, targetPath: reference.targetPath, reason: 'target_path_collision', collidesWith: previous.completionId });
    } else keys.set(reference.targetPath, reference);
  }
  return { references, invalid };
}

async function bodyBytes(body) {
  if (!body) return new Uint8Array();
  if (typeof body.transformToByteArray === 'function') return new Uint8Array(await body.transformToByteArray());
  const chunks = []; for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

export async function readS3Object(s3, bucket, key) {
  const object = await withRetry(() => s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
  const bytes = await bodyBytes(object.Body);
  return { bytes, size: Number(object.ContentLength), contentType: normalizeContentType(object.ContentType), metadata: object.Metadata || {}, hash: sha256(bytes), versionId: object.VersionId };
}

export async function assertSecureBucket(s3, bucket) {
  const [encryption, publicAccess, versioning] = await Promise.all([
    s3.send(new GetBucketEncryptionCommand({ Bucket: bucket })),
    s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket })),
    s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))
  ]);
  const algorithms = encryption.ServerSideEncryptionConfiguration?.Rules?.map((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm).filter(Boolean) || [];
  const block = publicAccess.PublicAccessBlockConfiguration || {};
  if (!algorithms.length) throw new Error('bucket sem encryption default');
  if (!['AES256', 'aws:kms', 'aws:kms:dsse'].includes(algorithms[0])) throw new Error('algoritmo de encryption do bucket não suportado');
  if (!block.BlockPublicAcls || !block.BlockPublicPolicy || !block.IgnorePublicAcls || !block.RestrictPublicBuckets) throw new Error('Block Public Access incompleto');
  if (versioning.Status !== 'Enabled') throw new Error('versioning do bucket não está habilitado');
  return { encryption: algorithms[0], blockPublicAccess: true, versioning: versioning.Status };
}

export async function fetchSourceObject(config, sourcePath) {
  const encoded = sourcePath.split('/').map(encodeURIComponent).join('/');
  const response = await withRetry(() => fetch(`${config.supabaseUrl}/storage/v1/object/authenticated/comprovantes/${encoded}`, {
    headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` }
  }).then((result) => result.ok || (result.status < 500 && result.status !== 429) ? result : Promise.reject(Object.assign(new Error(`Supabase Storage ${result.status}`), { status: result.status }))));
  if (!response.ok) throw Object.assign(new Error(`Supabase Storage ${response.status}`), { code: response.status === 404 ? 'SOURCE_MISSING' : 'SOURCE_ERROR' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, size: bytes.byteLength, hash: sha256(bytes), contentType: normalizeContentType(response.headers.get('content-type')) };
}

export function compareObject(reference, source, target) {
  const differences = [];
  if (source.size !== target.size || target.bytes.byteLength !== target.size) differences.push('size');
  if (source.hash !== target.hash) differences.push('sha256');
  if (source.contentType && source.contentType !== target.contentType) differences.push('content-type');
  if (target.metadata.workspace !== reference.workspace) differences.push('workspace');
  if (target.metadata.completion !== reference.completionId) differences.push('completion');
  if (target.metadata['source-path'] !== reference.sourcePath) differences.push('source-path');
  if (target.metadata.sha256 !== source.hash || target.metadata.sha256 !== target.hash) differences.push('metadata-sha256');
  return differences;
}

export function isNotFound(error) { return error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey'; }

export async function migrateReference({ s3, bucket, config, reference, fetchSource = fetchSourceObject }) {
  const source = await fetchSource(config, reference.sourcePath);
  try {
    const existing = await readS3Object(s3, bucket, reference.targetPath);
    const differences = compareObject(reference, source, existing);
    if (differences.length) throw Object.assign(new Error(`objeto existente diverge: ${differences.join(', ')}`), { code: 'MISMATCH', differences });
    return { status: 'verified', source, target: existing };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  let created = true;
  try { await withRetry(() => s3.send(new PutObjectCommand({
    Bucket: bucket, Key: reference.targetPath, IfNoneMatch: '*', Body: source.bytes, ContentType: source.contentType || 'application/octet-stream',
    Metadata: { workspace: reference.workspace, source: 'supabase', 'source-path': reference.sourcePath, sha256: source.hash, completion: reference.completionId }
  }))); } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412 && error?.name !== 'PreconditionFailed') throw error;
    created = false;
  }
  const target = await readS3Object(s3, bucket, reference.targetPath);
  const differences = compareObject(reference, source, target);
  if (differences.length) throw Object.assign(new Error(`verificação após upload divergiu: ${differences.join(', ')}`), { code: 'MISMATCH', differences });
  return { status: created ? 'copied' : 'verified', source, target };
}

async function listSupabaseFolder(config, prefix, output) {
  for (let offset = 0; ; offset += 1000) {
    const response = await withRetry(() => fetch(`${config.supabaseUrl}/storage/v1/object/list/comprovantes`, {
      method: 'POST', headers: { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    }).then((result) => result.ok || (result.status < 500 && result.status !== 429) ? result : Promise.reject(Object.assign(new Error(`Inventário Supabase Storage ${result.status}`), { status: result.status }))));
    if (!response.ok) throw new Error(`Inventário Supabase Storage respondeu HTTP ${response.status}`);
    const page = await response.json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id || item.metadata) output.push({ path, size: Number(item.metadata?.size ?? 0), contentType: normalizeContentType(item.metadata?.mimetype), classification: 'referenced' });
      else await listSupabaseFolder(config, path, output);
    }
    if (page.length < 1000) break;
  }
}

export async function listSupabaseObjects(config) { const objects = []; await listSupabaseFolder(config, '', objects); return objects; }

export async function listS3Objects(s3, bucket, prefix) {
  const objects = []; let ContinuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }));
    objects.push(...(page.Contents || []).map((item) => ({ path: item.Key, size: Number(item.Size) })));
    ContinuationToken = page.NextContinuationToken;
  } while (ContinuationToken);
  return objects;
}

export function classifyOrphans(sourceObjects, references, targetObjects) {
  const referencedSources = new Set(references.map((item) => item.sourcePath));
  const referencedTargets = new Set(references.map((item) => item.targetPath));
  const sourceOrphans = sourceObjects.filter((item) => !referencedSources.has(item.path)).map((item) => ({ ...item, classification: item.size === 0 ? 'empty_unreferenced_source' : 'unreferenced_source' }));
  const targetOrphans = targetObjects.filter((item) => !referencedTargets.has(item.path)).map((item) => ({ ...item, classification: 'unreferenced_target' }));
  return { sourceOrphans, targetOrphans };
}
