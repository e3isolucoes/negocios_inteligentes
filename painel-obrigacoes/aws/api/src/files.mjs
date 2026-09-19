import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_ENV, TOOL_ID } from './model.mjs';
import { requireModuleGrant } from './auth.mjs';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

function clean(value, fallback = 'file') {
  return String(value || fallback).normalize('NFKD').replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120);
}

export async function createUploadUrl(s3, bucket, auth, input) {
  requireModuleGrant(auth, 'obrigacoes');
  if (!ALLOWED_TYPES.has(input.contentType)) throw Object.assign(new Error('Tipo de arquivo não permitido.'), { statusCode: 400 });
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_BYTES) throw Object.assign(new Error('O arquivo deve ter no máximo 10 MB.'), { statusCode: 400 });
  const key = `${TOOL_ID}/${APP_ENV}/${auth.workspaceId}/obligations/${clean(input.obligationId)}/${clean(input.occurrenceDate)}/${randomUUID()}-${clean(input.fileName)}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType, ContentLength: input.size, Metadata: { workspace: auth.workspaceId, uploader: auth.userId, tool: TOOL_ID } });
  return { path: key, url: await getSignedUrl(s3, command, { expiresIn: 300 }), expiresIn: 300 };
}

export async function createDownloadUrl(s3, bucket, auth, path) {
  requireModuleGrant(auth, 'obrigacoes');
  const prefix = `${TOOL_ID}/${APP_ENV}/${auth.workspaceId}/`;
  if (!path?.startsWith(prefix) || path.includes('..')) throw Object.assign(new Error('Arquivo fora da empresa autorizada.'), { statusCode: 403 });
  return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: path }), { expiresIn: 300 }), expiresIn: 300 };
}

export async function deleteStoredFile(s3, bucket, auth, path) {
  requireModuleGrant(auth, 'obrigacoes');
  const prefix = `${TOOL_ID}/${APP_ENV}/${auth.workspaceId}/`;
  if (!path?.startsWith(prefix) || path.includes('..')) throw Object.assign(new Error('Arquivo fora da empresa autorizada.'), { statusCode: 403 });
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
}
