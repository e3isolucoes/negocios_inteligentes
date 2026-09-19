import assert from 'node:assert/strict';
import test from 'node:test';
import { SignJWT, decodeJwt } from 'jose';
import {
  authConfigurations,
  normalizeSupabaseIssuer,
  requireModuleGrant,
  resolveTokenAuthorization,
  resolveWorkspaceMembership,
} from '../src/auth.mjs';

test('normaliza o emissor Supabase sem duplicar /auth/v1', () => {
  assert.equal(normalizeSupabaseIssuer('https://project.supabase.co/auth/v1'), 'https://project.supabase.co/auth/v1');
  assert.equal(normalizeSupabaseIssuer('https://project.supabase.co/'), 'https://project.supabase.co/auth/v1');
});

test('rejeita emissor Supabase ausente', () => {
  assert.throws(() => normalizeSupabaseIssuer(''), /SUPABASE_ISSUER/);
});

test('aceita somente os emissores Cognito e Supabase explicitamente configurados', () => {
  assert.deepEqual(authConfigurations({
    AUTH_ISSUER: 'https://cognito.example/pool/', AUTH_AUDIENCE: 'client-id', SUPABASE_ISSUER: 'https://project.supabase.co',
  }), [
    { issuer: 'https://cognito.example/pool', audience: 'client-id' },
    { issuer: 'https://project.supabase.co/auth/v1', audience: 'authenticated' },
  ]);
});

test('preserva operação básica legada e exige Administração explícita', () => {
  assert.doesNotThrow(() => requireModuleGrant({ role: 'member', moduleGrants: null }, 'obrigacoes'));
  assert.doesNotThrow(() => requireModuleGrant({ role: 'member', moduleGrants: ['obrigacoes'] }, 'obrigacoes'));
  assert.throws(() => requireModuleGrant({ role: 'manager', moduleGrants: null }, 'administracao'), /não concedido/i);
  assert.throws(() => requireModuleGrant({ role: 'manager', moduleGrants: ['obrigacoes'] }, 'administracao'), /não concedido/i);
  assert.doesNotThrow(() => requireModuleGrant({ role: 'manager', moduleGrants: ['obrigacoes', 'administracao'] }, 'administracao'));
  assert.doesNotThrow(() => requireModuleGrant({ role: 'admin', moduleGrants: [] }, 'administracao'));
});

test('relatedCompanies não concede acesso ao workspace citado sem MEMBER real', () => {
  const record = {
    workspace_id: 'workspace-a',
    relatedCompanies: [{
      workspaceId: 'workspace-b',
      razaoSocial: 'MRSLA Participações Ltda.',
      cnpj: '12345678000190',
    }],
  };
  const memberships = [{
    PK: 'WORKSPACE#workspace-a',
    SK: 'MEMBER#user-1',
    workspaceId: 'workspace-a',
    userId: 'user-1',
    active: true,
    entityType: 'member',
    role: 'member',
  }];

  assert.throws(
    () => resolveWorkspaceMembership(memberships, record.relatedCompanies[0].workspaceId),
    (error) => error.statusCode === 403 && /não concedido/i.test(error.message),
  );
});

test('MEMBER real no workspace citado permite selecioná-lo pelo fluxo normal', () => {
  const memberships = [
    {
      PK: 'WORKSPACE#workspace-a',
      SK: 'MEMBER#user-1',
      workspaceId: 'workspace-a',
      userId: 'user-1',
      active: true,
      entityType: 'member',
      role: 'member',
    },
    {
      PK: 'WORKSPACE#workspace-b',
      SK: 'MEMBER#user-1',
      workspaceId: 'workspace-b',
      userId: 'user-1',
      active: true,
      entityType: 'member',
      role: 'member',
    },
  ];

  const selected = resolveWorkspaceMembership(memberships, 'workspace-b');
  assert.equal(selected.workspaceId, 'workspace-b');
  assert.equal(selected.SK, 'MEMBER#user-1');
});

test('tentativa de usar workspaceId da etiqueta é negada antes de ler RECORD sem MEMBER', async () => {
  const relatedWorkspaceId = 'workspace-b';
  const memberships = [{
    PK: 'WORKSPACE#workspace-a',
    SK: 'MEMBER#user-1',
    workspaceId: 'workspace-a',
    userId: 'user-1',
    active: true,
    entityType: 'member',
  }];
  let recordReadAttempted = false;

  async function readRecord(requestedWorkspaceId) {
    const membership = resolveWorkspaceMembership(memberships, requestedWorkspaceId);
    recordReadAttempted = true;
    return { workspaceId: membership.workspaceId };
  }

  await assert.rejects(
    readRecord(relatedWorkspaceId),
    (error) => error.statusCode === 403,
  );
  assert.equal(recordReadAttempted, false);
});

test('token forjado com workspace divergente do x-workspace-id é rejeitado', async () => {
  const secret = new TextEncoder().encode('segredo-local-de-teste-32-bytes-minimo');
  const token = await new SignJWT({
    sub: 'user-1',
    'custom:workspace_id': 'workspace-a',
    'custom:role': 'admin',
    'custom:module_grants': JSON.stringify(['obrigacoes']),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);

  const forgedClaims = decodeJwt(token);

  assert.throws(
    () => resolveTokenAuthorization(forgedClaims, {
      'x-workspace-id': 'workspace-b',
    }),
    (error) => error.statusCode === 403 && /diverge do token/i.test(error.message),
  );
});

test('token com workspace do claim é aceito sem exigir x-workspace-id', () => {
  const authorization = resolveTokenAuthorization({
    'custom:workspace_id': 'workspace-a',
    'custom:role': 'member',
    'custom:module_grants': JSON.stringify(['obrigacoes']),
  }, {});

  assert.deepEqual(authorization, {
    workspaceId: 'workspace-a',
    role: 'member',
    moduleGrants: ['obrigacoes'],
  });
});
