import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MEMBER_INDEX, memberSk, workspacePk } from './model-generic.mjs';

const jwksByIssuer = new Map();

export function normalizeSupabaseIssuer(value) {
  const issuer = String(value || '').replace(/\/+$/, '');
  if (!issuer) throw new Error('SUPABASE_ISSUER não configurado.');
  return issuer.endsWith('/auth/v1') ? issuer : `${issuer}/auth/v1`;
}

export function authConfiguration(env = process.env) {
  if (env.AUTH_ISSUER) return { issuer: String(env.AUTH_ISSUER).replace(/\/+$/, ''), audience: env.AUTH_AUDIENCE };
  return { issuer: normalizeSupabaseIssuer(env.SUPABASE_ISSUER), audience: 'authenticated' };
}

export function authConfigurations(env = process.env) {
  const configurations = [];
  if (env.AUTH_ISSUER) configurations.push({ issuer: String(env.AUTH_ISSUER).replace(/\/+$/, ''), audience: env.AUTH_AUDIENCE });
  if (env.SUPABASE_ISSUER) configurations.push({ issuer: normalizeSupabaseIssuer(env.SUPABASE_ISSUER), audience: 'authenticated' });
  if (!configurations.length) configurations.push(authConfiguration(env));
  return configurations.filter((item, index, all) => all.findIndex(candidate => candidate.issuer === item.issuer) === index);
}

function bearer(headers = {}) {
  const value = headers.authorization || headers.Authorization || '';
  if (!value.startsWith('Bearer ')) throw Object.assign(new Error('Autenticação obrigatória.'), { statusCode: 401 });
  return value.slice(7);
}


export function resolveWorkspaceMembership(memberships, requestedWorkspaceId) {
  const active = (memberships || []).filter((item) => (
    item?.active !== false
    && item?.entityType === 'member'
    && item?.workspaceId
    && item?.PK === workspacePk(item.workspaceId)
    && String(item?.SK || '').startsWith('MEMBER#')
  ));
  if (!active.length) {
    throw Object.assign(new Error('Usuário sem acesso ao Painel de Obrigações.'), { statusCode: 403 });
  }

  const requested = String(requestedWorkspaceId || '').trim();
  const membership = requested
    ? active.find((item) => item.workspaceId === requested)
    : active[0];

  if (!membership) {
    throw Object.assign(new Error('Acesso à empresa não concedido.'), { statusCode: 403 });
  }
  return membership;
}

export function resolveLegacyCognitoAuthorization(memberships, payload = {}, headers = {}) {
  const headerWorkspaceId = String(
    headers?.['x-workspace-id'] || headers?.['X-Workspace-Id'] || '',
  ).trim();
  const activeWorkspaceId = String(payload['custom:active_workspace_id'] || '').trim();

  if (headerWorkspaceId && activeWorkspaceId && headerWorkspaceId !== activeWorkspaceId) {
    throw Object.assign(
      new Error('Workspace do cabeçalho diverge da sessão ativa.'),
      { statusCode: 403 },
    );
  }

  const membership = resolveWorkspaceMembership(
    memberships,
    headerWorkspaceId || activeWorkspaceId,
  );
  return {
    workspaceId: membership.workspaceId,
    role: membership.role || 'member',
    moduleGrants: Array.isArray(membership.module_grants)
      ? membership.module_grants
      : null,
  };
}


function parseModuleGrantsClaim(value) {
  if (value === undefined || value === null || value === '') return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error('invalid');
    return [...new Set(parsed.map(String).filter(Boolean))];
  } catch {
    throw Object.assign(new Error('Claims de autorização inválidos.'), { statusCode: 401 });
  }
}

export function resolveTokenAuthorization(payload = {}, headers = {}) {
  const workspaceId = String(payload['custom:workspace_id'] || '').trim();
  const role = String(payload['custom:role'] || '').trim();
  const allowedRoles = new Set(['member', 'manager', 'admin', 'super_admin']);

  try {
    workspacePk(workspaceId);
  } catch {
    throw Object.assign(new Error('Token sem workspace autorizado.'), { statusCode: 401 });
  }
  if (!allowedRoles.has(role)) {
    throw Object.assign(new Error('Token sem papel autorizado.'), { statusCode: 401 });
  }

  const requested = String(headers?.['x-workspace-id'] || headers?.['X-Workspace-Id'] || '').trim();
  if (requested && requested !== workspaceId) {
    throw Object.assign(new Error('Workspace do cabeçalho diverge do token.'), { statusCode: 403 });
  }

  return {
    workspaceId,
    role,
    moduleGrants: parseModuleGrantsClaim(payload['custom:module_grants']),
  };
}

export async function authenticate(event, documentClient, tableName) {
  const token = bearer(event.headers);
  let tokenIssuer = '';
  try { tokenIssuer = String(decodeJwt(token).iss || '').replace(/\/+$/, ''); } catch {}
  const configuration = authConfigurations().find(item => item.issuer === tokenIssuer);
  if (!configuration) throw Object.assign(new Error('Sessão inválida ou expirada.'), { statusCode: 401 });
  const { issuer, audience } = configuration;
  if (!jwksByIssuer.has(issuer)) jwksByIssuer.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwksByIssuer.get(issuer), {
      issuer,
      audience,
      algorithms: ['RS256', 'ES256'],
      clockTolerance: 5,
    }));
  } catch {
    throw Object.assign(new Error('Sessão inválida ou expirada.'), { statusCode: 401 });
  }

  const userId = payload['custom:legacy_user_id'] || payload['cognito:username'] || payload.sub;
  const cognitoIssuer = String(process.env.AUTH_ISSUER || '').replace(/\/+$/, '');
  if (cognitoIssuer && issuer === cognitoIssuer) {
    let authorization;
    try {
      authorization = resolveTokenAuthorization(payload, event.headers);
    } catch (error) {
      const legacyClaimGap = error?.statusCode === 401
        && /Token sem (workspace|papel) autorizado\./.test(String(error.message || ''));
      if (!legacyClaimGap) throw error;

      // Compatibilidade segura durante rollout do Pre Token Generation:
      // tokens emitidos pelo pool antes do trigger podem não conter os claims
      // derivados, mas ainda carregam o seletor de workspace gravado pelo Portal.
      // O seletor nunca concede acesso sozinho: papel e grants são relidos do
      // MEMBER canônico no DynamoDB antes de autorizar qualquer operação.
      const result = await documentClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: MEMBER_INDEX,
        KeyConditionExpression: 'GSI1PK = :memberPk AND begins_with(GSI1SK, :workspacePrefix)',
        ExpressionAttributeValues: {
          ':memberPk': memberSk(userId),
          ':workspacePrefix': 'WORKSPACE#',
        },
      }));
      authorization = resolveLegacyCognitoAuthorization(
        result.Items || [],
        payload,
        event.headers,
      );
    }
    return {
      userId,
      email: payload.email,
      ...authorization,
      issuer,
      tokenId: payload.jti || null,
    };
  }

  // Compatibilidade transitória do emissor secundário: tokens não-Cognito
  // ainda resolvem membership no banco até a retirada completa desse fluxo.
  const result = await documentClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: MEMBER_INDEX,
    KeyConditionExpression: 'GSI1PK = :memberPk AND begins_with(GSI1SK, :workspacePrefix)',
    ExpressionAttributeValues: {
      ':memberPk': memberSk(userId),
      ':workspacePrefix': 'WORKSPACE#',
    },
  }));
  const requested = event.headers?.['x-workspace-id'] || event.headers?.['X-Workspace-Id'];
  const membership = resolveWorkspaceMembership(result.Items || [], requested);
  return {
    userId,
    email: payload.email,
    workspaceId: membership.workspaceId,
    role: membership.role || 'member',
    moduleGrants: Array.isArray(membership.module_grants) ? membership.module_grants : null,
    issuer,
    tokenId: payload.jti || null,
  };
}

export function requireRole(auth, roles) {
  if (!roles.includes(auth.role)) throw Object.assign(new Error('Seu perfil não permite esta operação.'), { statusCode: 403 });
}

export function requireModuleGrant(auth, grant) {
  // Compatibilidade operacional: vínculos legados continuam podendo usar
  // Obrigações enquanto o bootstrap de grants é concluído.
  if (!grant || grant === 'obrigacoes') return;
  if (['admin', 'super_admin'].includes(auth?.role)) return;
  // Capacidades administrativas são sempre deny-by-default.
  if (!Array.isArray(auth?.moduleGrants) || !auth.moduleGrants.includes(grant)) {
    throw Object.assign(new Error('Módulo não concedido para este acesso.'), { statusCode: 403 });
  }
}
