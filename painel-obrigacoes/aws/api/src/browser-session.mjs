import { createHash, randomBytes } from 'node:crypto';
import { AdminInitiateAuthCommand, RevokeTokenCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export const REFRESH_COOKIE = '__Host-e3i_refresh';
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const tokenKey = token => ({ PK: `BROWSER_SESSION#${digest(token)}`, SK: `BROWSER_SESSION#${digest(token)}` });
const familyKey = familyId => ({ PK: `SESSION_FAMILY#${familyId}`, SK: `SESSION_FAMILY#${familyId}` });

export function refreshCookie(token, maxAge = REFRESH_TTL_SECONDS) {
  const value = token ? `${REFRESH_COOKIE}=${token}` : `${REFRESH_COOKIE}=`;
  return `${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
}

export function readRefreshCookie(headers = {}) {
  const raw = headers.cookie || headers.Cookie || '';
  const entry = raw.split(';').map(value => value.trim()).find(value => value.startsWith(`${REFRESH_COOKIE}=`));
  return entry ? entry.slice(REFRESH_COOKIE.length + 1) : '';
}

async function putToken(documentClient, tableName, token, familyId, refreshToken, now) {
  await documentClient.send(new PutCommand({
    TableName: tableName,
    Item: { ...tokenKey(token), entityType: 'browser_session', familyId, refreshToken, status: 'active', expiresAt: Math.floor(now / 1000) + REFRESH_TTL_SECONDS },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
}

export async function issueBrowserSession(documentClient, tableName, refreshToken, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  const familyId = randomBytes(16).toString('base64url');
  await documentClient.send(new PutCommand({ TableName: tableName, Item: { ...familyKey(familyId), entityType: 'session_family', revoked: false, expiresAt: Math.floor(now / 1000) + REFRESH_TTL_SECONDS } }));
  await putToken(documentClient, tableName, token, familyId, refreshToken, now);
  return token;
}

export async function createPasswordSession(cognito, documentClient, tableName, config, username, password, now = Date.now()) {
  const authenticated = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: config.userPoolId, ClientId: config.clientId, AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: username, PASSWORD: password },
  }));
  const tokens = authenticated.AuthenticationResult || {};
  if (!tokens.IdToken || !tokens.AccessToken || !tokens.RefreshToken) throw Object.assign(new Error('Credenciais inválidas.'), { statusCode: 401 });
  return { cookieToken: await issueBrowserSession(documentClient, tableName, tokens.RefreshToken, now), access_token: tokens.IdToken, cognito_access_token: tokens.AccessToken };
}

async function revokeFamily(cognito, documentClient, tableName, item, clientId) {
  await documentClient.send(new UpdateCommand({ TableName: tableName, Key: familyKey(item.familyId), UpdateExpression: 'SET revoked = :yes', ExpressionAttributeValues: { ':yes': true } }));
  if (item.refreshToken) await cognito.send(new RevokeTokenCommand({ ClientId: clientId, Token: item.refreshToken })).catch(() => {});
}

export async function rotateBrowserSession(cognito, documentClient, tableName, config, token, now = Date.now()) {
  const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: tokenKey(token), ConsistentRead: true }));
  const item = current.Item;
  if (!item || item.entityType !== 'browser_session' || item.expiresAt < Math.floor(now / 1000)) throw Object.assign(new Error('Sessão inválida ou expirada.'), { statusCode: 401 });
  const family = await documentClient.send(new GetCommand({ TableName: tableName, Key: familyKey(item.familyId), ConsistentRead: true }));
  if (item.status !== 'active' || family.Item?.revoked) {
    await revokeFamily(cognito, documentClient, tableName, item, config.clientId);
    throw Object.assign(new Error('Reutilização de credencial detectada; sessão revogada.'), { statusCode: 401 });
  }
  try {
    await documentClient.send(new UpdateCommand({
      TableName: tableName, Key: tokenKey(token), UpdateExpression: 'SET #status = :rotated',
      ConditionExpression: '#status = :active', ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':active': 'active', ':rotated': 'rotated' },
    }));
  } catch {
    await revokeFamily(cognito, documentClient, tableName, item, config.clientId);
    throw Object.assign(new Error('Reutilização de credencial detectada; sessão revogada.'), { statusCode: 401 });
  }
  const authenticated = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: config.userPoolId, ClientId: config.clientId, AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: item.refreshToken },
  }));
  const tokens = authenticated.AuthenticationResult || {};
  if (!tokens.IdToken || !tokens.AccessToken) throw new Error('Cognito não renovou a sessão.');
  const nextRefresh = tokens.RefreshToken || item.refreshToken;
  const nextToken = randomBytes(32).toString('base64url');
  await putToken(documentClient, tableName, nextToken, item.familyId, nextRefresh, now);
  return { cookieToken: nextToken, access_token: tokens.IdToken, cognito_access_token: tokens.AccessToken };
}

export async function revokeBrowserSession(cognito, documentClient, tableName, clientId, token) {
  if (!token) return;
  const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: tokenKey(token), ConsistentRead: true }));
  if (current.Item) await revokeFamily(cognito, documentClient, tableName, current.Item, clientId);
}
