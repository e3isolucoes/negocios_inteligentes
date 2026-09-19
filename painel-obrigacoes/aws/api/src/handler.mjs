import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { authenticate } from './auth.mjs';
import { createDownloadUrl, createUploadUrl, deleteStoredFile } from './files.mjs';
import { provisionPortalAccess, verifyPortalProvisioning } from './portal-provisioning.mjs';
import { consumePortalSession, createPortalSession } from './portal-session.mjs';
import { Repository } from './repository.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});
const repository = new Repository(ddb, process.env.TABLE_NAME);

function allowedOrigin(event) {
  const allowlist = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const requested = event.headers?.origin || event.headers?.Origin;
  return allowlist.includes(requested) ? requested : allowlist[0];
}

function response(statusCode, body, event) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'access-control-allow-origin': allowedOrigin(event), 'access-control-allow-headers': 'authorization,content-type,x-workspace-id', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-max-age': '600', vary: 'origin' }, body: statusCode === 204 ? '' : JSON.stringify(body) };
}

function parseBody(event) {
  if (!event.body) return {};
  const bytes = Buffer.byteLength(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (bytes > 32_768) throw Object.assign(new Error('Requisição excede o limite de 32 KiB.'), { statusCode: 413 });
  try { return JSON.parse(event.body); } catch { throw Object.assign(new Error('JSON inválido.'), { statusCode: 400 }); }
}

function listOptions(event) {
  const query = event.queryStringParameters || {};
  return { limit: query.limit, cursor: query.cursor };
}

export async function handler(event) {
  if (event.requestContext?.http?.method === 'OPTIONS') return response(204, {}, event);
  const requestId = event.requestContext?.requestId;
  try {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const path = (event.rawPath || event.path || '/').replace(/^\/v1\/?/, '');
    if (method === 'POST' && path === 'internal/portal-access') {
      verifyPortalProvisioning(event, process.env.PORTAL_PROVISIONING_SECRET);
      const input = parseBody(event);
      const access = await provisionPortalAccess(ddb, process.env.TABLE_NAME, input);
      const session = await createPortalSession(cognito, ddb, process.env.TABLE_NAME, {
        userPoolId: process.env.USER_POOL_ID, clientId: process.env.USER_POOL_CLIENT_ID,
      }, { ...access, email: String(input.email).trim().toLowerCase(), displayName: String(input.displayName).trim() });
      return response(200, { ...access, ...session }, event);
    }
    if (method === 'POST' && path === 'portal-session/exchange') {
      return response(200, await consumePortalSession(ddb, process.env.TABLE_NAME, parseBody(event).code), event);
    }

    const auth = await authenticate(event, ddb, process.env.TABLE_NAME);
    if (method === 'GET' && path === 'me') return response(200, { userId: auth.userId, email: auth.email, workspaceId: auth.workspaceId, role: auth.role, moduleGrants: auth.moduleGrants }, event);
    if (path === 'files/upload-url' && method === 'POST') return response(200, await createUploadUrl(s3, process.env.FILES_BUCKET, auth, parseBody(event)), event);
    if (path === 'files/download-url' && method === 'POST') return response(200, await createDownloadUrl(s3, process.env.FILES_BUCKET, auth, parseBody(event).path), event);

    const [entity, id] = path.split('/').map(decodeURIComponent);
    if (method === 'GET' && !id) return response(200, await repository.list(auth, entity, listOptions(event)), event);
    if (method === 'GET' && id) return response(200, await repository.get(auth, entity, id), event);
    if (method === 'POST' && !id) return response(201, await repository.create(auth, entity, parseBody(event)), event);
    if (method === 'PATCH' && id) return response(200, await repository.update(auth, entity, id, parseBody(event)), event);
    if (method === 'DELETE' && id) {
      const current = entity === 'completions' ? await repository.get(auth, entity, id) : null;
      if (current?.attachment_path) await deleteStoredFile(s3, process.env.FILES_BUCKET, auth, current.attachment_path);
      await repository.remove(auth, entity, id);
      return response(204, {}, event);
    }
    return response(404, { error: 'Rota não encontrada.', requestId }, event);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(JSON.stringify({ level: 'error', requestId, status, name: error.name, message: status < 500 ? error.message : 'internal_error' }));
    return response(status, { error: status < 500 ? error.message : 'Erro interno.', requestId }, event);
  }
}
