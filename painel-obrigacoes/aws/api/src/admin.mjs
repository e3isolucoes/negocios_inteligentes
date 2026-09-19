import { randomUUID } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DeleteCommand,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  APP_ENV,
  SCHEMA_VERSION,
  TOOL_ID,
  publicRecord,
  tenantPk,
} from './model.mjs';
import {
  GENERIC_SCHEMA_VERSION,
  memberIndexKeys,
  memberSk,
  workspacePk,
} from './model-generic.mjs';

const timestamp = () => new Date().toISOString();
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const ROLES = new Set(['member', 'manager', 'admin', 'super_admin']);

const normalizeRole = (role) => ({
  membro: 'member',
  gestor: 'manager',
  administrador: 'admin',
})[role] || role || 'member';

const legacyRole = (role) => ({
  member: 'membro',
  manager: 'gestor',
})[role] || role || 'membro';

const normalizeGrants = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) throw fail('Concessões inválidas.', 400);
  const grants = [...new Set(value.map((grant) => String(grant || '').trim()).filter(Boolean))];
  if (grants.some((grant) => !/^[a-z][a-z0-9-]{1,63}$/.test(grant))) {
    throw fail('Concessão inválida.', 400);
  }
  return grants;
};

const isToolAdmin = (auth) => ['admin', 'super_admin'].includes(auth?.role);
const hasAdministrationGrant = (auth) => (
  isToolAdmin(auth)
  || (Array.isArray(auth?.moduleGrants) && auth.moduleGrants.includes('administracao'))
);

function memberResponse(member) {
  if (!member) return null;
  const { PK, SK, GSI1PK, GSI1SK, ...record } = member;
  return { ...record, role: legacyRole(record.role) };
}

export class AdminService {
  constructor(client, cognito, tableName, userPoolId) {
    this.client = client;
    this.cognito = cognito;
    this.tableName = tableName;
    this.userPoolId = userPoolId;
  }

  requireMembershipAdministration(auth, workspaceId, {
    requestedRole,
    roleChanged = false,
    grantsChanged = false,
  } = {}) {
    const role = normalizeRole(requestedRole);
    if (!ROLES.has(role)) throw fail('Papel inválido.', 400);
    if (!auth?.userId) throw fail('Autenticação obrigatória.', 401);

    if (auth.role === 'super_admin') return;
    if (auth.workspaceId !== workspaceId || !hasAdministrationGrant(auth)) {
      throw fail('Você não pode administrar este vínculo.', 403);
    }
    if (role === 'super_admin') throw fail('Somente super_admin pode conceder este papel.', 403);
    if (roleChanged && !isToolAdmin(auth)) {
      throw fail('Somente o Admin da Ferramenta pode alterar papéis de acesso.', 403);
    }
    if (grantsChanged && !isToolAdmin(auth)) {
      throw fail('Somente o Admin da Ferramenta pode alterar concessões administrativas.', 403);
    }
  }

  async inviteUser(auth, input = {}) {
    const workspaceId = String(input.workspaceId || auth.workspaceId || '').trim();
    const role = normalizeRole(input.role);
    const requestedGrants = normalizeGrants(input.module_grants);
    const moduleGrants = requestedGrants || ['obrigacoes'];

    this.requireMembershipAdministration(auth, workspaceId, {
      requestedRole: role,
      roleChanged: role !== 'member',
      grantsChanged: requestedGrants !== undefined,
    });

    if (!moduleGrants.includes('obrigacoes')) moduleGrants.unshift('obrigacoes');
    if (moduleGrants.includes('administracao') && !isToolAdmin(auth)) {
      throw fail('Somente o Admin da Ferramenta pode conceder Administração.', 403);
    }

    const email = String(input.email || '').trim().toLowerCase();
    const displayName = String(input.displayName || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || !displayName) {
      throw fail('Informe nome e e-mail válidos.', 400);
    }

    let userId = randomUUID();
    let cognitoCreated = false;
    try {
      try {
        await this.cognito.send(new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: displayName },
            { Name: 'custom:legacy_user_id', Value: userId },
          ],
        }));
        cognitoCreated = true;
      } catch (error) {
        if (error.name !== 'UsernameExistsException' || input.linkExisting !== true) throw error;
        const existing = await this.cognito.send(new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        }));
        const attributes = new Map((existing.UserAttributes || []).map((item) => [item.Name, item.Value]));
        if (String(attributes.get('email') || '').toLowerCase() !== email) {
          throw fail('A identidade existente não corresponde ao e-mail informado.', 409);
        }
        userId = attributes.get('custom:legacy_user_id') || existing.Username;
      }

      const now = timestamp();
      const index = memberIndexKeys(workspaceId, userId);
      const member = {
        PK: workspacePk(workspaceId),
        SK: memberSk(userId),
        ...index,
        userId,
        workspaceId,
        email,
        role,
        module_grants: moduleGrants,
        active: true,
        toolId: TOOL_ID,
        environment: APP_ENV,
        entityType: 'member',
        schemaVersion: GENERIC_SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      };
      const profile = {
        PK: tenantPk(workspaceId),
        SK: `PROFILE#${userId}`,
        id: userId,
        email,
        display_name: displayName,
        role: legacyRole(role),
        module_grants: moduleGrants,
        module_access: [],
        workspace_id: workspaceId,
        active: true,
        version: 1,
        toolId: TOOL_ID,
        environment: APP_ENV,
        entityType: 'profiles',
        schemaVersion: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      };

      await this.client.send(new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: member,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: profile,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      }));

      return {
        user: { id: userId, email },
        profile: publicRecord(profile),
        invitation: 'email',
      };
    } catch (error) {
      if (cognitoCreated) {
        await this.cognito.send(new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        })).catch(() => null);
      }
      if (error.name === 'UsernameExistsException') throw fail('Já existe uma conta com esse e-mail.', 409);
      if (error.name === 'TransactionCanceledException') throw fail('Já existe um vínculo para este usuário.', 409);
      throw error;
    }
  }

  async setMembership(auth, userId, workspaceId, input = {}) {
    const memberKey = { PK: workspacePk(workspaceId), SK: memberSk(userId) };
    const current = (await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: memberKey,
      ConsistentRead: true,
    }))).Item;
    if (!current) throw fail('Vínculo não encontrado.', 404);

    const requestedRole = input.role === undefined ? current.role : normalizeRole(input.role);
    const requestedGrants = normalizeGrants(input.module_grants);
    const roleChanged = input.role !== undefined && requestedRole !== current.role;
    const grantsChanged = requestedGrants !== undefined;

    this.requireMembershipAdministration(auth, workspaceId, {
      requestedRole,
      roleChanged,
      grantsChanged,
    });

    if (auth.userId === userId && (roleChanged || grantsChanged || input.active === false)) {
      throw fail('Não é permitido alterar o próprio vínculo administrativo.', 403);
    }

    const moduleGrants = requestedGrants ?? current.module_grants ?? ['obrigacoes'];
    if (!moduleGrants.includes('obrigacoes')) moduleGrants.unshift('obrigacoes');
    if (moduleGrants.includes('administracao') && !isToolAdmin(auth)) {
      throw fail('Somente o Admin da Ferramenta pode conceder Administração.', 403);
    }

    const profileKey = { PK: tenantPk(workspaceId), SK: `PROFILE#${userId}` };
    const profile = (await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: profileKey,
      ConsistentRead: true,
    }))).Item;
    if (!profile) throw fail('Perfil legado do vínculo não encontrado.', 409);

    const now = timestamp();
    const nextMember = {
      ...current,
      role: requestedRole,
      module_grants: moduleGrants,
      active: input.active ?? current.active ?? true,
      updated_at: now,
    };
    const nextProfile = {
      ...profile,
      role: legacyRole(requestedRole),
      module_grants: moduleGrants,
      active: nextMember.active,
      ...(input.displayName ? { display_name: String(input.displayName).trim() } : {}),
      version: Number(profile.version || 1) + 1,
      updated_at: now,
    };

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: nextMember,
            ConditionExpression: '#role = :role AND active = :active',
            ExpressionAttributeNames: { '#role': 'role' },
            ExpressionAttributeValues: {
              ':role': current.role,
              ':active': current.active ?? true,
            },
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: nextProfile,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    }));

    return memberResponse(nextMember);
  }

  async removeMembership(auth, userId, workspaceId) {
    this.requireMembershipAdministration(auth, workspaceId, { requestedRole: 'member' });
    if (auth.userId === userId) throw fail('Não é permitido remover o próprio vínculo.', 403);

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: this.tableName,
            Key: { PK: workspacePk(workspaceId), SK: memberSk(userId) },
          },
        },
        {
          Delete: {
            TableName: this.tableName,
            Key: { PK: tenantPk(workspaceId), SK: `PROFILE#${userId}` },
          },
        },
      ],
    }));
  }
}
