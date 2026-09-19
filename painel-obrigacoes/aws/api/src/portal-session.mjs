import { createHash, randomBytes } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APP_ENV, TOOL_ID } from './model.mjs';

const SESSION_TTL_SECONDS = 60;
const CODE_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

function codeKey(code) {
  const digest = createHash('sha256').update(code, 'utf8').digest('hex');
  return { PK: `PORTAL_SESSION#${digest}`, SK: `PORTAL_SESSION#${digest}` };
}

function attributeMap(attributes = []) {
  return Object.fromEntries(attributes.map(({ Name, Value }) => [Name, Value]));
}

async function ensureCognitoUser(cognito, { userPoolId, email, userId, displayName }) {
  let current;
  try {
    current = await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
  } catch (error) {
    if (error?.name !== 'UserNotFoundException') throw error;
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: displayName },
        { Name: 'custom:legacy_user_id', Value: userId },
      ],
    }));
    return;
  }
  const attributes = attributeMap(current.UserAttributes);
  if (attributes['custom:legacy_user_id'] && attributes['custom:legacy_user_id'] !== userId) {
    throw Object.assign(new Error('Conta Cognito vinculada a outro usuário.'), { statusCode: 409 });
  }
  const updates = [
    { Name: 'email_verified', Value: 'true' },
    { Name: 'name', Value: displayName },
  ];
  if (!attributes['custom:legacy_user_id']) updates.push({ Name: 'custom:legacy_user_id', Value: userId });
  await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: userPoolId, Username: email, UserAttributes: updates }));
}

export async function createPortalSession(cognito, documentClient, tableName, config, identity, now = Date.now()) {
  const { userPoolId, clientId } = config;
  if (!userPoolId || !clientId) throw Object.assign(new Error('Cognito não configurado.'), { statusCode: 503 });
  await ensureCognitoUser(cognito, { userPoolId, ...identity });
  const password = `A1!${randomBytes(32).toString('base64url')}`;
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: identity.email, Password: password, Permanent: true }));
  const authenticated = await cognito.send(new AdminInitiateAuthCommand({
    UserPoolId: userPoolId,
    ClientId: clientId,
    AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: identity.email, PASSWORD: password },
  }));
  const tokens = authenticated.AuthenticationResult;
  if (!tokens?.IdToken || !tokens?.AccessToken) throw new Error('Cognito não emitiu a sessão esperada.');

  const launchCode = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  await documentClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...codeKey(launchCode), entityType: 'portal_session', toolId: TOOL_ID, environment: APP_ENV,
      userId: identity.userId, workspaceId: identity.workspaceId, expiresAt,
      idToken: tokens.IdToken, accessToken: tokens.AccessToken, refreshToken: tokens.RefreshToken,
      created_at: new Date(now).toISOString(),
    },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
  return { launchCode, expiresIn: SESSION_TTL_SECONDS };
}

export async function consumePortalSession(documentClient, tableName, code, now = Date.now()) {
  if (!CODE_PATTERN.test(String(code || ''))) throw Object.assign(new Error('Código de acesso inválido.'), { statusCode: 400 });
  const consumed = await documentClient.send(new DeleteCommand({ TableName: tableName, Key: codeKey(code), ReturnValues: 'ALL_OLD' }));
  const item = consumed.Attributes;
  if (!item || item.entityType !== 'portal_session' || item.toolId !== TOOL_ID || item.environment !== APP_ENV || item.expiresAt < Math.floor(now / 1000)) {
    throw Object.assign(new Error('Código de acesso inválido ou expirado.'), { statusCode: 401 });
  }
  return { access_token: item.idToken, cognito_access_token: item.accessToken, refresh_token: item.refreshToken };
}
