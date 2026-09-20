import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { APP_ENV, SCHEMA_VERSION, tenantPk, TOOL_ID } from './model.mjs';
import {
  entitlementSk,
  GENERIC_SCHEMA_VERSION,
  memberIndexKeys,
  memberSk,
  workspacePk as genericWorkspacePk,
} from './model-generic.mjs';

const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
const NONCE_TTL_SECONDS = Math.ceil(MAX_CLOCK_SKEW_MS / 1000) + 30;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;

function header(headers, name) {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] || '';
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function signPortalProvisioning(secret, timestamp, nonce, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`, 'utf8')
    .digest('hex');
}

export function signLegacyPortalProvisioning(secret, timestamp, rawBody) {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
}

function legacyReplayNonce(timestamp, signature, rawBody) {
  return createHash('sha256')
    .update(`legacy.${timestamp}.${signature}.${rawBody}`, 'utf8')
    .digest('base64url');
}

export function verifyPortalProvisioning(event, secret, now = Date.now()) {
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error('Integração do Portal E3I não configurada.'), { statusCode: 503 });
  }

  const timestamp = header(event.headers, 'x-e3i-timestamp');
  const nonce = header(event.headers, 'x-e3i-nonce') || header(event.headers, 'x-request-id');
  const signature = header(event.headers, 'x-e3i-signature');
  const rawBody = event.body || '';

  const numericTimestamp = Number(timestamp);
  const timestampMs = numericTimestamp > 0 && numericTimestamp < 10_000_000_000
    ? numericTimestamp * 1000
    : numericTimestamp;

  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > MAX_CLOCK_SKEW_MS) {
    throw Object.assign(new Error('Solicitação de acesso expirada.'), { statusCode: 401 });
  }

  if (NONCE_PATTERN.test(nonce)) {
    const expected = signPortalProvisioning(secret, timestamp, nonce, rawBody);
    if (!safeEqualHex(signature, expected)) {
      throw Object.assign(new Error('Assinatura do Portal E3I inválida.'), { statusCode: 401 });
    }
    return { nonce, timestampMs, legacy: false };
  }

  const legacyExpected = signLegacyPortalProvisioning(secret, timestamp, rawBody);
  if (safeEqualHex(signature, legacyExpected)) {
    return {
      nonce: legacyReplayNonce(timestamp, signature, rawBody),
      timestampMs,
      legacy: true,
    };
  }

  if (!NONCE_PATTERN.test(nonce)) {
    throw Object.assign(new Error('Nonce criptográfico obrigatório ou inválido.'), { statusCode: 401 });
  }

  throw Object.assign(new Error('Assinatura do Portal E3I inválida.'), { statusCode: 401 });
}

export async function claimPortalProvisioningNonce(client, tableName, nonce, now = Date.now()) {
  const digest = createHash('sha256').update(nonce, 'utf8').digest('hex');
  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `PORTAL_NONCE#${digest}`,
        SK: `PORTAL_NONCE#${digest}`,
        entityType: 'portal_provisioning_nonce',
        expiresAt: Math.floor(now / 1000) + NONCE_TTL_SECONDS,
        created_at: new Date(now).toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      throw Object.assign(new Error('Nonce já utilizado.'), { statusCode: 409 });
    }
    throw error;
  }
}

function validateInput(input) {
  const userId = String(input.userId || '');
  const workspaceId = String(input.workspaceId || '');
  const email = String(input.email || '').trim().toLowerCase();
  const displayName = String(input.displayName || '').trim();
  const workspaceName = String(input.workspaceName || '').trim();
  const document = String(input.document || '').replace(/\D/g, '');

  if (!IDENTIFIER.test(userId) || !IDENTIFIER.test(workspaceId)) {
    throw Object.assign(new Error('Identificadores inválidos.'), { statusCode: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error('E-mail inválido.'), { statusCode: 400 });
  }
  if (!displayName || displayName.length > 160 || !workspaceName || workspaceName.length > 180) {
    throw Object.assign(new Error('Dados de acesso inválidos.'), { statusCode: 400 });
  }
  if (document && (document.length < 11 || document.length > 14)) {
    throw Object.assign(new Error('Documento empresarial inválido.'), { statusCode: 400 });
  }

  return { userId, workspaceId, email, displayName, workspaceName, document };
}

export async function provisionPortalAccess(client, tableName, input) {
  const data = validateInput(input);
  const timestamp = new Date().toISOString();
  const auditId = randomUUID();
  const workspacePk = tenantPk(data.workspaceId);
  const genericPk = genericWorkspacePk(data.workspaceId);
  const memberIndex = memberIndexKeys(data.workspaceId, data.userId);
  const metadata = { ':tool': TOOL_ID, ':environment': APP_ENV, ':schema': SCHEMA_VERSION, ':now': timestamp };

  await client.send(new TransactWriteCommand({ TransactItems: [
    { Update: {
      TableName: tableName,
      Key: { PK: genericPk, SK: memberSk(data.userId) },
      UpdateExpression: 'SET userId=:userId, workspaceId=:workspaceId, #email=:email, active=:true, #role=if_not_exists(#role,:member), module_grants=if_not_exists(module_grants,:defaultModuleGrants), GSI1PK=:gsi1pk, GSI1SK=:gsi1sk, toolId=:tool, environment=:environment, entityType=:memberEntity, schemaVersion=:schema, updated_at=:now, created_at=if_not_exists(created_at,:now)',
      ExpressionAttributeNames: { '#role': 'role', '#email': 'email' },
      ExpressionAttributeValues: {
        ...metadata,
        ':workspaceId': data.workspaceId,
        ':userId': data.userId,
        ':email': data.email,
        ':true': true,
        ':member': 'member',
        ':memberEntity': 'member',
        ':defaultModuleGrants': ['obrigacoes'],
        ':gsi1pk': memberIndex.GSI1PK,
        ':gsi1sk': memberIndex.GSI1SK,
      },
    } },
    { Update: {
      TableName: tableName,
      Key: { PK: workspacePk, SK: `PROFILE#${data.userId}` },
      UpdateExpression: 'SET id=:userId, workspace_id=:workspaceId, #email=:email, display_name=:displayName, active=:true, #role=if_not_exists(#role,:legacyMember), toolId=:tool, environment=:environment, entityType=:profile, schemaVersion=:schema, updated_at=:now, created_at=if_not_exists(created_at,:now)',
      ExpressionAttributeNames: { '#role': 'role', '#email': 'email' },
      ExpressionAttributeValues: { ...metadata, ':workspaceId': data.workspaceId, ':userId': data.userId, ':email': data.email, ':displayName': data.displayName, ':true': true, ':legacyMember': 'membro', ':profile': 'profiles' },
    } },
    { Update: {
      TableName: tableName,
      Key: { PK: genericPk, SK: entitlementSk('obrigacoes') },
      UpdateExpression: 'SET workspace_id=:workspaceId, moduleId=:moduleId, #plan=if_not_exists(#plan,:portalPlan), #status=if_not_exists(#status,:activeStatus), startedAt=if_not_exists(startedAt,:startedAt), updatedAt=:updatedAt, entityType=:entitlementEntity, schemaVersion=:genericSchema',
      ExpressionAttributeNames: { '#plan': 'plan', '#status': 'status' },
      ExpressionAttributeValues: {
        ':workspaceId': data.workspaceId,
        ':moduleId': 'obrigacoes',
        ':portalPlan': 'portal',
        ':activeStatus': 'ativo',
        ':startedAt': timestamp,
        ':updatedAt': timestamp,
        ':entitlementEntity': 'entitlement',
        ':genericSchema': GENERIC_SCHEMA_VERSION,
      },
    } },
    { Update: {
      TableName: tableName,
      Key: { PK: workspacePk, SK: `WORKSPACE_META#${data.workspaceId}` },
      UpdateExpression: 'SET id=:workspaceId, #name=:workspaceName, document=:document, access_status=if_not_exists(access_status,:full), toolId=:tool, environment=:environment, entityType=:workspace, schemaVersion=:schema, updated_at=:now, created_at=if_not_exists(created_at,:now)',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ...metadata, ':workspaceId': data.workspaceId, ':workspaceName': data.workspaceName, ':document': data.document, ':full': 'full', ':workspace': 'workspaces' },
    } },
    { Put: { TableName: tableName, Item: {
      PK: workspacePk, SK: `AUDIT#${timestamp}#${auditId}`, id: auditId, entityType: 'audit_log',
      toolId: TOOL_ID, environment: APP_ENV, workspace_id: data.workspaceId,
      action: 'PORTAL_ACCESS_PROVISIONED', table_name: 'memberships', record_id: data.userId,
      actor_id: 'portal-e3i', actor_email: 'portal@e3isolucoes.com.br',
      new_data: { userId: data.userId, email: data.email, role: 'member' }, created_at: timestamp, schemaVersion: SCHEMA_VERSION,
    } } },
  ] }));

  return { userId: data.userId, workspaceId: data.workspaceId, role: 'member' };
}
