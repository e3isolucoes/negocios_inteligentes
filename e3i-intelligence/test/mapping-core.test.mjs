import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IntelligenceError,
  InMemoryMappingRepository,
  MappingCore,
  PERMISSIONS,
} from '../src/mapping-core.mjs';

const FIXED_DATE = new Date('2026-09-15T20:00:00.000Z');
const clock = () => new Date(FIXED_DATE);
const policy = {
  dataClassification: 'INTERNAL',
  processingPurposeId: 'process-mapping-v1',
  retentionClass: 'ANALYTICS_2Y',
  containsPersonalData: false,
  containsSensitivePersonalData: false,
};

function context(tenantId = 'tenant-a', permissions = [PERMISSIONS.READ, PERMISSIONS.WRITE]) {
  return { tenantId, actorId: `actor-${tenantId}`, permissions };
}

function service(options = {}) {
  return new MappingCore({
    repository: new InMemoryMappingRepository(),
    enabled: true,
    clock,
    idFactory: () => 'map-12345678',
    ...options,
  });
}

function expectCode(fn, code, status) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof IntelligenceError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

test('feature is OFF by default', () => {
  const core = new MappingCore();
  expectCode(() => core.listMappings(context()), 'FEATURE_DISABLED', 503);
});

test('creates mapping from scratch using tenant and actor from authenticated context', () => {
  const core = service();
  const mapping = core.createMapping(context(), {
    name: 'Contas a Pagar',
    mappingType: 'PROCESS',
    description: 'Mapeamento inicial',
  });

  assert.equal(mapping.mappingId, 'map-12345678');
  assert.equal(mapping.tenantId, 'tenant-a');
  assert.equal(mapping.createdByActorId, 'actor-tenant-a');
  assert.equal(mapping.status, 'DRAFT');
  assert.deepEqual(mapping.sources, ['USER_INTERVIEW']);
  assert.equal(mapping.createdAt, FIXED_DATE.toISOString());
});

test('rejects tenantId supplied by client payload', () => {
  const core = service();
  expectCode(
    () => core.createMapping(context('tenant-a'), {
      tenantId: 'tenant-b',
      name: 'Tentativa cross tenant',
      mappingType: 'PROCESS',
    }),
    'TENANT_FROM_CLIENT_FORBIDDEN',
  );
});

test('enforces granular read and write permissions', () => {
  const core = service();
  expectCode(
    () => core.createMapping(context('tenant-a', [PERMISSIONS.READ]), { name: 'X', mappingType: 'PROCESS' }),
    'FORBIDDEN',
    403,
  );
  expectCode(() => core.listMappings(context('tenant-a', [PERMISSIONS.WRITE])), 'FORBIDDEN', 403);
});

test('isolates tenants on read and list', () => {
  const repository = new InMemoryMappingRepository();
  const coreA = service({ repository, idFactory: () => 'map-aaaaaaaa' });
  const coreB = service({ repository, idFactory: () => 'map-bbbbbbbb' });

  coreA.createMapping(context('tenant-a'), { name: 'Processo A', mappingType: 'PROCESS' });
  coreB.createMapping(context('tenant-b'), { name: 'Processo B', mappingType: 'PROCESS' });

  assert.deepEqual(coreA.listMappings(context('tenant-a')).map((m) => m.mappingId), ['map-aaaaaaaa']);
  assert.deepEqual(coreB.listMappings(context('tenant-b')).map((m) => m.mappingId), ['map-bbbbbbbb']);
  expectCode(() => coreA.getMapping(context('tenant-a'), 'map-bbbbbbbb'), 'NOT_FOUND', 404);
});

test('human activity always receives USER_DECLARED provenance from backend', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'Compras', mappingType: 'PROCESS' });
  const updated = core.addHumanActivity(context(), mapping.mappingId, {
    name: 'Receber cotação',
    frequencyPerMonth: 15,
    workMinutesPerOccurrence: 8,
    hourlyCost: 80,
    currency: 'brl',
    provenancePolicy: policy,
  });

  const activity = updated.activities[0];
  assert.equal(activity.provenance.sourceType, 'USER_DECLARED');
  assert.equal(activity.provenance.declaredByActorId, 'actor-tenant-a');
  assert.equal(activity.provenance.processingPurposeId, 'process-mapping-v1');
  assert.equal(activity.currency, 'BRL');
});

test('manual flow cannot claim measured E3I tool provenance', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'Fiscal', mappingType: 'PROCESS' });
  expectCode(
    () => core.addHumanFact(context(), mapping.mappingId, {
      key: 'lead_time_hours',
      value: 20,
      provenancePolicy: { ...policy, sourceType: 'E3I_TOOL_MEASURED' },
    }),
    'PROVENANCE_SOURCE_FORBIDDEN',
  );
});

test('personal data requires approved legal basis reference', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'Atendimento', mappingType: 'PROCESS' });
  expectCode(
    () => core.addHumanFact(context(), mapping.mappingId, {
      key: 'responsible_email',
      value: 'usuario@example.com',
      provenancePolicy: {
        ...policy,
        dataClassification: 'PERSONAL_DATA',
        containsPersonalData: true,
      },
    }),
    'LGPD_GOVERNANCE_REQUIRED',
  );
});

test('sensitive personal data enforces compatible classification', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'RH', mappingType: 'AREA' });
  expectCode(
    () => core.addHumanFact(context(), mapping.mappingId, {
      key: 'health_context',
      value: 'redacted',
      provenancePolicy: {
        ...policy,
        legalBasisRef: 'legal-basis-approved-1',
        containsSensitivePersonalData: true,
        dataClassification: 'INTERNAL',
      },
    }),
    'LGPD_CLASSIFICATION_INVALID',
  );
});

test('audit callback receives metadata only and not raw mapping content', () => {
  const records = [];
  const core = service({ audit: (event) => records.push(event) });
  const mapping = core.createMapping(context(), { name: 'Nome confidencial', mappingType: 'PROCESS' });
  core.addHumanFact(context(), mapping.mappingId, {
    key: 'secret-note',
    value: 'conteudo que nao deve ir para log',
    provenancePolicy: policy,
  });

  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes('Nome confidencial'), false);
  assert.equal(serialized.includes('conteudo que nao deve ir para log'), false);
  assert.equal(serialized.includes('secret-note'), false);
  assert.equal(records.at(-1).action, 'MAPPING_FACT_ADDED');
});

test('repository returns clones so callers cannot mutate persisted state', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'Imutável', mappingType: 'PROCESS' });
  mapping.name = 'Mutado externamente';
  const persisted = core.getMapping(context(), mapping.mappingId);
  assert.equal(persisted.name, 'Imutável');
});

test('rejects invalid activity numeric ranges', () => {
  const core = service();
  const mapping = core.createMapping(context(), { name: 'Financeiro', mappingType: 'PROCESS' });
  expectCode(
    () => core.addHumanActivity(context(), mapping.mappingId, {
      name: 'Conferir',
      reworkRate: 1.5,
      provenancePolicy: policy,
    }),
    'VALIDATION_ERROR',
  );
});
