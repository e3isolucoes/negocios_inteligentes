import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { tenantPk } from './model.mjs';
import { MEMBER_INDEX, memberSk, workspacePk } from './model-generic.mjs';

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;

function attributes(user) {
  return new Map((user?.UserAttributes || []).map((attribute) => [attribute.Name, attribute.Value]));
}

function normalizedDocument(value) {
  return String(value || '').replace(/\D/g, '');
}

function activeMember(item) {
  return Boolean(
    item
    && item.entityType === 'member'
    && item.active !== false
    && IDENTIFIER.test(String(item.workspaceId || '')),
  );
}

async function directMember(client, tableName, workspaceId, userId) {
  if (!IDENTIFIER.test(String(workspaceId || '')) || !IDENTIFIER.test(String(userId || ''))) return null;
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: workspacePk(workspaceId), SK: memberSk(userId) },
    ConsistentRead: true,
  }));
  return activeMember(result.Item) ? result.Item : null;
}

async function membersByUser(client, tableName, userId) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: MEMBER_INDEX,
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :workspace)',
    ExpressionAttributeValues: {
      ':pk': `MEMBER#${userId}`,
      ':workspace': 'WORKSPACE#',
    },
  }));
  return (result.Items || []).filter(activeMember);
}

async function workspaceDocument(client, tableName, workspaceId) {
  const legacy = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: tenantPk(workspaceId), SK: `WORKSPACE_META#${workspaceId}` },
    ConsistentRead: true,
  }));
  if (legacy.Item?.document) return normalizedDocument(legacy.Item.document);

  const generic = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: workspacePk(workspaceId), SK: 'METADATA' },
    ConsistentRead: true,
  }));
  return normalizedDocument(generic.Item?.document || generic.Item?.cnpj);
}

export async function resolvePortalIdentity(cognito, client, tableName, userPoolId, input) {
  const email = String(input?.email || '').trim().toLowerCase();
  const requestedWorkspaceId = String(input?.workspaceId || '');
  const requestedDocument = normalizedDocument(input?.document);

  if (!userPoolId || !email) return input;

  let cognitoUser;
  try {
    cognitoUser = await cognito.send(new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    }));
  } catch (error) {
    if (error?.name === 'UserNotFoundException') return { ...input, email };
    throw error;
  }

  const legacyUserId = String(attributes(cognitoUser).get('custom:legacy_user_id') || '');
  if (!IDENTIFIER.test(legacyUserId)) return { ...input, email };

  const requestedMember = await directMember(
    client,
    tableName,
    requestedWorkspaceId,
    legacyUserId,
  );
  if (requestedMember) {
    return {
      ...input,
      email,
      userId: legacyUserId,
      workspaceId: requestedWorkspaceId,
    };
  }

  const memberships = await membersByUser(client, tableName, legacyUserId);
  if (!memberships.length) {
    return { ...input, email, userId: legacyUserId };
  }

  if (!requestedDocument && memberships.length === 1) {
    return {
      ...input,
      email,
      userId: legacyUserId,
      workspaceId: memberships[0].workspaceId,
    };
  }

  if (requestedDocument) {
    const matches = [];
    for (const membership of memberships) {
      const document = await workspaceDocument(client, tableName, membership.workspaceId);
      if (document === requestedDocument) matches.push(membership);
    }

    if (matches.length > 1) {
      throw Object.assign(
        new Error('Mais de um vínculo existente corresponde ao documento informado.'),
        { statusCode: 409 },
      );
    }

    if (matches.length === 1) {
      return {
        ...input,
        email,
        userId: legacyUserId,
        workspaceId: matches[0].workspaceId,
      };
    }
  }

  return { ...input, email, userId: legacyUserId };
}
