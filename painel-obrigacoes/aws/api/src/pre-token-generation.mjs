import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  MEMBER_INDEX,
  assertWorkspaceId,
  memberSk,
  workspacePk,
} from './model-generic.mjs';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({}),
  { marshallOptions: { removeUndefinedValues: true } },
);

const ALLOWED_ROLES = new Set(['member', 'manager', 'admin', 'super_admin']);

function authenticatedUserId(event) {
  const attributes = event?.request?.userAttributes || {};
  return String(
    attributes['custom:legacy_user_id']
    || attributes.sub
    || event?.userName
    || '',
  ).trim();
}

function isCanonicalActiveMember(item, userId) {
  return Boolean(
    item
    && item.active !== false
    && item.entityType === 'member'
    && item.userId === userId
    && item.workspaceId
    && item.PK === workspacePk(item.workspaceId)
    && item.SK === memberSk(userId),
  );
}

function validateMember(member, userId) {
  if (!isCanonicalActiveMember(member, userId)) {
    throw new Error('Usuário sem MEMBER ativo no workspace selecionado.');
  }
  if (!ALLOWED_ROLES.has(member.role)) {
    throw new Error('Papel inválido no MEMBER selecionado.');
  }
  return member;
}

async function singleMembershipFallback(client, tableName, userId) {
  const result = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: MEMBER_INDEX,
    KeyConditionExpression: 'GSI1PK = :memberPk AND begins_with(GSI1SK, :workspacePrefix)',
    ExpressionAttributeValues: {
      ':memberPk': memberSk(userId),
      ':workspacePrefix': 'WORKSPACE#',
    },
  }));

  const active = (result.Items || []).filter((item) => isCanonicalActiveMember(item, userId));
  if (active.length !== 1) {
    throw new Error('Workspace ativo não selecionado para esta sessão.');
  }
  return validateMember(active[0], userId);
}

export async function resolveMemberForToken(event, client, tableName) {
  const userId = authenticatedUserId(event);
  if (!userId) throw new Error('Usuário autenticado sem identificador válido.');

  const selector = String(
    event?.request?.userAttributes?.['custom:active_workspace_id'] || '',
  ).trim();

  if (!selector) {
    return singleMembershipFallback(client, tableName, userId);
  }

  const workspaceId = assertWorkspaceId(selector);
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: workspacePk(workspaceId),
      SK: memberSk(userId),
    },
    ConsistentRead: true,
  }));

  const member = validateMember(result.Item, userId);
  if (member.workspaceId !== workspaceId) {
    throw new Error('MEMBER diverge do workspace selecionado.');
  }
  return member;
}

export async function buildPreTokenClaims(event, client, tableName) {
  const member = await resolveMemberForToken(event, client, tableName);
  const moduleGrants = Array.isArray(member.module_grants)
    ? [...new Set(member.module_grants.map(String).filter(Boolean))]
    : [];

  return {
    'custom:workspace_id': member.workspaceId,
    'custom:role': member.role,
    'custom:module_grants': JSON.stringify(moduleGrants),
  };
}

export function applyPreTokenClaims(event, claims) {
  event.response = {
    ...(event.response || {}),
    claimsOverrideDetails: {
      ...(event.response?.claimsOverrideDetails || {}),
      claimsToAddOrOverride: {
        ...(event.response?.claimsOverrideDetails?.claimsToAddOrOverride || {}),
        ...claims,
      },
      claimsToSuppress: [
        ...new Set([
          ...(event.response?.claimsOverrideDetails?.claimsToSuppress || []),
          'custom:active_workspace_id',
        ]),
      ],
    },
  };
  return event;
}

export async function handler(event) {
  const claims = await buildPreTokenClaims(event, ddb, process.env.TABLE_NAME);
  return applyPreTokenClaims(event, claims);
}
