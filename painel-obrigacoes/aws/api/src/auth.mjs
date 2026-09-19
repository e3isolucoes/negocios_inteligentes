import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { membershipPk } from './model.mjs';

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
  const result = await documentClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': membershipPk(userId), ':sk': 'MEMBERSHIP#' },
    ConsistentRead: true
  }));
  const active = (result.Items || []).filter((item) => item.active !== false);
  if (!active.length) throw Object.assign(new Error('Usuário sem acesso ao Painel de Obrigações.'), { statusCode: 403 });

  const requested = event.headers?.['x-workspace-id'] || event.headers?.['X-Workspace-Id'];
  const membership = requested ? active.find((item) => item.workspaceId === requested) : active[0];
  if (!membership) throw Object.assign(new Error('Acesso à empresa não concedido.'), { statusCode: 403 });
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
  if (!Array.isArray(auth.moduleGrants)) return;
  if (!auth.moduleGrants.includes(grant)) {
    throw Object.assign(new Error('Módulo não concedido para este acesso.'), { statusCode: 403 });
  }
}
