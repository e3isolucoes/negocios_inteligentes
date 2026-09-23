import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryMappingRepository,
  MappingCore,
  PERMISSIONS,
} from '../src/mapping-core.mjs';
import { createMappingApi } from '../src/mapping-api.mjs';
import { assertMappingRepository, mappingStorageKey } from '../src/mapping-repository.mjs';

const FIXED_DATE = new Date('2026-09-15T23:30:00.000Z');
const clock = () => new Date(FIXED_DATE);
const policy = {
  dataClassification: 'INTERNAL',
  processingPurposeId: 'process-mapping-v1',
  retentionClass: 'ANALYTICS_2Y',
  containsPersonalData: false,
  containsSensitivePersonalData: false,
};

function auth(tenantId = 'tenant-a', permissions = [PERMISSIONS.READ, PERMISSIONS.WRITE]) {
  return { tenantId, actorId: `actor-${tenantId}`, permissions };
}

function setup({ enabled = true, repository = new InMemoryMappingRepository(), maxBodyBytes } = {}) {
  const core = new MappingCore({
    repository,
    enabled,
    clock,
    idFactory: () => 'map-api0001',
  });
  return { core, api: createMappingApi({ core, ...(maxBodyBytes ? { maxBodyBytes } : {}) }) };
}

async function request(api, method, path, requestAuth, body) {
  return api.handle({ method, path, auth: requestAuth, body });
}

test('repository boundary requires tenant-scoped save/get/list contract', () => {
  const repository = new InMemoryMappingRepository();
  assert.equal(assertMappingRepository(repository), repository);
  assert.throws(() => assertMappingRepository({ save() {} }), /must implement get/);
  assert.notEqual(mappingStorageKey('a::b', 'c'), mappingStorageKey('a', 'b::c'));
});

test('API keeps Intelligence feature OFF behavior as 503', async () => {
  const { api } = setup({ enabled: false });
  const result = await request(api, 'GET', '/v1/mappings', auth());
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'FEATURE_DISABLED');
});

test('API rejects unauthenticated and unauthorized requests', async () => {
  const { api } = setup();
  const unauthenticated = await request(api, 'GET', '/v1/mappings');
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, 'UNAUTHENTICATED');

  const forbidden = await request(api, 'POST', '/v1/mappings', auth('tenant-a', [PERMISSIONS.READ]), {
    name: 'Financeiro',
    mappingType: 'PROCESS',
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, 'FORBIDDEN');
});

test('API creates mapping from scratch without accepting security context from payload', async () => {
  const { api } = setup();
  const created = await request(api, 'POST', '/v1/mappings', auth('tenant-a'), {
    name: 'Contas a pagar',
    mappingType: 'PROCESS',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.tenantId, 'tenant-a');
  assert.equal(created.body.createdByActorId, 'actor-tenant-a');

  for (const reserved of ['tenantId', 'actorId', 'permissions', 'auth', 'context']) {
    const blocked = await request(api, 'POST', '/v1/mappings', auth('tenant-a'), {
      name: 'Tentativa',
      mappingType: 'PROCESS',
      [reserved]: reserved === 'permissions' ? ['*'] : 'attacker-controlled',
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error.code, 'SECURITY_CONTEXT_FROM_CLIENT_FORBIDDEN');
  }
});

test('API lists and reads only mappings from authenticated tenant', async () => {
  const repository = new InMemoryMappingRepository();
  const coreA = new MappingCore({ repository, enabled: true, clock, idFactory: () => 'map-tenantaa' });
  const apiA = createMappingApi({ core: coreA });
  await request(apiA, 'POST', '/v1/mappings', auth('tenant-a'), { name: 'A', mappingType: 'PROCESS' });

  const coreB = new MappingCore({ repository, enabled: true, clock, idFactory: () => 'map-tenantbb' });
  const apiB = createMappingApi({ core: coreB });
  await request(apiB, 'POST', '/v1/mappings', auth('tenant-b'), { name: 'B', mappingType: 'PROCESS' });

  const listA = await request(apiA, 'GET', '/v1/mappings', auth('tenant-a'));
  assert.equal(listA.status, 200);
  assert.deepEqual(listA.body.items.map((item) => item.mappingId), ['map-tenantaa']);

  const crossTenant = await request(apiA, 'GET', '/v1/mappings/map-tenantbb', auth('tenant-a'));
  assert.equal(crossTenant.status, 404);
  assert.equal(crossTenant.body.error.code, 'NOT_FOUND');
  assert.equal(JSON.stringify(crossTenant.body).includes('tenant-b'), false);
});

test('API supports human activities and facts while backend owns provenance', async () => {
  const { api } = setup();
  const created = await request(api, 'POST', '/v1/mappings', auth(), {
    name: 'Compras',
    mappingType: 'PROCESS',
  });

  const activity = await request(api, 'POST', `/v1/mappings/${created.body.mappingId}/activities`, auth(), {
    name: 'Solicitar cotação',
    frequencyPerMonth: 10,
    provenancePolicy: policy,
  });
  assert.equal(activity.status, 201);
  assert.equal(activity.body.activities[0].provenance.sourceType, 'USER_DECLARED');

  const fact = await request(api, 'POST', `/v1/mappings/${created.body.mappingId}/facts`, auth(), {
    key: 'monthly_volume',
    value: 450,
    unit: 'documentos',
    provenancePolicy: policy,
  });
  assert.equal(fact.status, 201);
  assert.equal(fact.body.facts[0].provenance.sourceType, 'USER_DECLARED');
});

test('API rejects invalid JSON and oversized payloads', async () => {
  const { api } = setup({ maxBodyBytes: 1024 });
  const invalid = await api.handle({
    method: 'POST',
    path: '/v1/mappings',
    auth: auth(),
    rawBody: '{not-json',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_JSON');

  const oversized = await api.handle({
    method: 'POST',
    path: '/v1/mappings',
    auth: auth(),
    body: { name: 'X'.repeat(1500), mappingType: 'PROCESS' },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('API sanitizes unexpected internal errors', async () => {
  const repository = new InMemoryMappingRepository();
  const core = {
    repository,
    listMappings() {
      throw new Error('database-secret-and-sensitive-content');
    },
  };
  const api = createMappingApi({ core });
  const result = await api.handle({ method: 'GET', path: '/v1/mappings', auth: auth() });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
  assert.equal(JSON.stringify(result.body).includes('database-secret'), false);
});

test('API returns explicit 404 and 405 contracts', async () => {
  const { api } = setup();
  const unknown = await request(api, 'GET', '/v1/unknown', auth());
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'ROUTE_NOT_FOUND');

  const wrongMethod = await request(api, 'DELETE', '/v1/mappings', auth());
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.error.code, 'METHOD_NOT_ALLOWED');
});
