import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { authenticate } from './auth.mjs';
import { createDownloadUrl, createUploadUrl, deleteStoredFile } from './files.mjs';
import { claimPortalProvisioningNonce, provisionPortalAccess, verifyPortalProvisioning } from './portal-provisioning.mjs';
import { resolvePortalIdentity } from './portal-identity.mjs';
import { consumePortalSession, createPortalSession } from './portal-session.mjs';
import {
  createPasswordSession,
  issueBrowserSession,
  readRefreshCookie,
  refreshCookie,
  revokeBrowserSession,
  rotateBrowserSession,
} from './browser-session.mjs';
import { Repository } from './repository.mjs';
import { GenericRepository } from './repository-generic.mjs';
import { ObrigacoesRepository } from './repository-obrigacoes.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const cognito = new CognitoIdentityProviderClient({});
const repository = new Repository(ddb, process.env.TABLE_NAME);
const genericRepository = new GenericRepository(ddb, process.env.TABLE_NAME);
const obrigacoesRepository = new ObrigacoesRepository(ddb, process.env.TABLE_NAME);

function repositoryFor(entity) {
  return obrigacoesRepository.supports(entity) ? obrigacoesRepository : repository;
}

const OFFICIAL_BROWSER_ORIGINS = Object.freeze([
  'https://obrigacoes.e3isolucoes.com.br',
]);

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(value).replace(/\/$/, '');
  }
}

export function allowedOrigin(event) {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',').map((origin) => normalizeOrigin(origin.trim())).filter(Boolean);
  const allowlist = [...new Set([
    ...OFFICIAL_BROWSER_ORIGINS.map(normalizeOrigin),
    ...configured,
  ])];
  const requested = normalizeOrigin(event.headers?.origin || event.headers?.Origin);
  if (!requested) return allowlist[0] || '';
  return allowlist.includes(requested) ? requested : '';
}

export function response(statusCode, body, event, extraHeaders = {}) {
  const origin = allowedOrigin(event);
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(origin ? {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-workspace-id',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-max-age': '600',
        vary: 'origin',
      } : {}),
      ...extraHeaders,
    },
    body: statusCode === 204 ? '' : JSON.stringify(body),
  };
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
      const verified = verifyPortalProvisioning(event, process.env.PORTAL_PROVISIONING_SECRET);
      await claimPortalProvisioningNonce(ddb, process.env.TABLE_NAME, verified.nonce);
      const receivedInput = parseBody(event);
      const input = await resolvePortalIdentity(
        cognito,
        ddb,
        process.env.TABLE_NAME,
        process.env.USER_POOL_ID,
        receivedInput,
      );
      const access = await provisionPortalAccess(ddb, process.env.TABLE_NAME, input);
      const session = await createPortalSession(cognito, ddb, process.env.TABLE_NAME, {
        userPoolId: process.env.USER_POOL_ID, clientId: process.env.USER_POOL_CLIENT_ID,
      }, {
        ...access,
        email: String(input.email).trim().toLowerCase(),
        displayName: String(input.displayName).trim(),
      });
      return response(200, { ...access, ...session }, event);
    }
    if (method === 'POST' && path === 'portal-session/exchange') {
      const session = await consumePortalSession(ddb, process.env.TABLE_NAME, parseBody(event).code);
      const cookieToken = await issueBrowserSession(
        ddb,
        process.env.TABLE_NAME,
        session.refresh_token,
      );
      return response(
        200,
        {
          access_token: session.access_token,
          cognito_access_token: session.cognito_access_token,
        },
        event,
        { 'set-cookie': refreshCookie(cookieToken) },
      );
    }

    if (method === 'POST' && path === 'session/login') {
      const input = parseBody(event);
      const created = await createPasswordSession(
        cognito,
        ddb,
        process.env.TABLE_NAME,
        {
          userPoolId: process.env.USER_POOL_ID,
          clientId: process.env.USER_POOL_CLIENT_ID,
        },
        String(input.email || '').trim().toLowerCase(),
        String(input.password || ''),
      );
      return response(
        200,
        {
          access_token: created.access_token,
          cognito_access_token: created.cognito_access_token,
        },
        event,
        { 'set-cookie': refreshCookie(created.cookieToken) },
      );
    }

    if (method === 'POST' && path === 'session/refresh') {
      const refreshToken = readRefreshCookie(event.headers);
      if (!refreshToken) return response(204, {}, event);
      const rotated = await rotateBrowserSession(
        cognito,
        ddb,
        process.env.TABLE_NAME,
        {
          userPoolId: process.env.USER_POOL_ID,
          clientId: process.env.USER_POOL_CLIENT_ID,
        },
        refreshToken,
      );
      return response(
        200,
        {
          access_token: rotated.access_token,
          cognito_access_token: rotated.cognito_access_token,
        },
        event,
        { 'set-cookie': refreshCookie(rotated.cookieToken) },
      );
    }

    if (method === 'DELETE' && path === 'session') {
      await revokeBrowserSession(
        cognito,
        ddb,
        process.env.TABLE_NAME,
        process.env.USER_POOL_CLIENT_ID,
        readRefreshCookie(event.headers),
      );
      return response(204, {}, event, { 'set-cookie': refreshCookie('', 0) });
    }

    const auth = await authenticate(event, ddb, process.env.TABLE_NAME);
    if (method === 'GET' && path === 'me') return response(200, { userId: auth.userId, email: auth.email, workspaceId: auth.workspaceId, role: auth.role, moduleGrants: auth.moduleGrants }, event);

    const entitlementRoute = path.match(/^workspaces\/([^/]+)\/entitlements$/);
    if (method === 'GET' && entitlementRoute) {
      const workspaceId = decodeURIComponent(entitlementRoute[1]);
      if (workspaceId !== auth.workspaceId) {
        throw Object.assign(new Error('Acesso à empresa não concedido.'), { statusCode: 403 });
      }
      return response(200, {
        workspaceId,
        items: await genericRepository.listEntitlements(workspaceId),
      }, event);
    }

    // O Painel atual pertence ao módulo "obrigacoes". Mesmo rotas legadas e
    // arquivos S3 exigem contrato ativo; o papel do usuário nunca substitui
    // o entitlement do workspace.
    await genericRepository.requireActiveEntitlement(auth.workspaceId, 'obrigacoes');

    if (path === 'files/upload-url' && method === 'POST') return response(200, await createUploadUrl(s3, process.env.FILES_BUCKET, auth, parseBody(event)), event);
    if (path === 'files/download-url' && method === 'POST') return response(200, await createDownloadUrl(s3, process.env.FILES_BUCKET, auth, parseBody(event).path), event);

    const [entity, id] = path.split('/').map(decodeURIComponent);
    const activeRepository = repositoryFor(entity);
    if (method === 'GET' && !id) return response(200, await activeRepository.list(auth, entity, listOptions(event)), event);
    if (method === 'GET' && id) return response(200, await activeRepository.get(auth, entity, id), event);
    if (method === 'POST' && !id) return response(201, await activeRepository.create(auth, entity, parseBody(event)), event);
    if (method === 'PATCH' && id) return response(200, await activeRepository.update(auth, entity, id, parseBody(event)), event);
    if (method === 'DELETE' && id) {
      const current = entity === 'completions' ? await activeRepository.get(auth, entity, id) : null;
      if (current?.attachment_path) await deleteStoredFile(s3, process.env.FILES_BUCKET, auth, current.attachment_path);
      await activeRepository.remove(auth, entity, id);
      return response(204, {}, event);
    }
    return response(404, { error: 'Rota não encontrada.', requestId }, event);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(JSON.stringify({ level: 'error', requestId, status, name: error.name, message: status < 500 ? error.message : 'internal_error' }));
    return response(status, { error: status < 500 ? error.message : 'Erro interno.', requestId }, event);
  }
}
