import { randomUUID } from 'node:crypto';

export class IntelligenceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'IntelligenceError';
    this.code = code;
    this.status = status;
  }
}

export const PERMISSIONS = Object.freeze({
  READ: 'intelligence.mapping.read',
  WRITE: 'intelligence.mapping.write',
});

const ALLOWED_MAPPING_TYPES = new Set([
  'PROCESS',
  'AREA',
  'AUTOMATION_OPPORTUNITY',
  'COST',
  'RISK',
  'JOURNEY',
  'OTHER',
]);

const ALLOWED_CLASSIFICATIONS = new Set([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PERSONAL_DATA',
  'SENSITIVE_PERSONAL_DATA',
  'RESTRICTED',
]);

const ALLOWED_RETENTION = new Set([
  'EPHEMERAL_30D',
  'OPERATIONAL_1Y',
  'ANALYTICS_2Y',
  'AUDIT_POLICY',
  'CUSTOM_POLICY',
]);

function requireText(value, field, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new IntelligenceError('VALIDATION_ERROR', `${field} is required`);
  if (normalized.length > maxLength) {
    throw new IntelligenceError('VALIDATION_ERROR', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function assertContext(context, permission) {
  if (!context || typeof context !== 'object') {
    throw new IntelligenceError('UNAUTHENTICATED', 'Authenticated context is required', 401);
  }
  const tenantId = requireText(context.tenantId, 'context.tenantId', 160);
  const actorId = requireText(context.actorId, 'context.actorId', 160);
  const permissions = new Set(Array.isArray(context.permissions) ? context.permissions : []);
  if (!permissions.has(permission)) {
    throw new IntelligenceError('FORBIDDEN', `Missing permission: ${permission}`, 403);
  }
  return { tenantId, actorId };
}

function assertNoClientTenant(payload) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'tenantId')) {
    throw new IntelligenceError(
      'TENANT_FROM_CLIENT_FORBIDDEN',
      'tenantId must be derived from the authenticated context',
      400,
    );
  }
}

function buildHumanProvenance({ actorId, policy, now }) {
  if (!policy || typeof policy !== 'object') {
    throw new IntelligenceError('PROVENANCE_REQUIRED', 'provenancePolicy is required');
  }
  if (Object.prototype.hasOwnProperty.call(policy, 'sourceType')) {
    throw new IntelligenceError(
      'PROVENANCE_SOURCE_FORBIDDEN',
      'Manual input cannot choose its sourceType',
    );
  }

  const dataClassification = requireText(policy.dataClassification, 'dataClassification', 80);
  if (!ALLOWED_CLASSIFICATIONS.has(dataClassification)) {
    throw new IntelligenceError('VALIDATION_ERROR', 'Invalid dataClassification');
  }

  const processingPurposeId = requireText(policy.processingPurposeId, 'processingPurposeId', 120);
  const retentionClass = requireText(policy.retentionClass, 'retentionClass', 80);
  if (!ALLOWED_RETENTION.has(retentionClass)) {
    throw new IntelligenceError('VALIDATION_ERROR', 'Invalid retentionClass');
  }

  const containsSensitivePersonalData = policy.containsSensitivePersonalData === true;
  const containsPersonalData = policy.containsPersonalData === true || containsSensitivePersonalData;
  const legalBasisRef = String(policy.legalBasisRef ?? '').trim();

  if (containsPersonalData && !legalBasisRef) {
    throw new IntelligenceError(
      'LGPD_GOVERNANCE_REQUIRED',
      'Personal data requires legalBasisRef',
    );
  }

  if (containsSensitivePersonalData && !['SENSITIVE_PERSONAL_DATA', 'RESTRICTED'].includes(dataClassification)) {
    throw new IntelligenceError(
      'LGPD_CLASSIFICATION_INVALID',
      'Sensitive personal data must be classified as SENSITIVE_PERSONAL_DATA or RESTRICTED',
    );
  }

  return {
    sourceType: 'USER_DECLARED',
    declaredByActorId: actorId,
    collectedAt: now,
    dataClassification,
    processingPurposeId,
    retentionClass,
    containsPersonalData,
    containsSensitivePersonalData,
    ...(legalBasisRef ? { legalBasisRef } : {}),
  };
}

function clone(value) {
  return structuredClone(value);
}

export class InMemoryMappingRepository {
  #items = new Map();

  #key(tenantId, mappingId) {
    return `${tenantId}::${mappingId}`;
  }

  save(mapping) {
    this.#items.set(this.#key(mapping.tenantId, mapping.mappingId), clone(mapping));
    return clone(mapping);
  }

  get(tenantId, mappingId) {
    const item = this.#items.get(this.#key(tenantId, mappingId));
    return item ? clone(item) : null;
  }

  list(tenantId) {
    return [...this.#items.values()]
      .filter((item) => item.tenantId === tenantId)
      .map(clone);
  }
}

export class MappingCore {
  constructor({ repository = new InMemoryMappingRepository(), enabled = false, clock = () => new Date(), idFactory, audit = () => {} } = {}) {
    this.repository = repository;
    this.enabled = enabled;
    this.clock = clock;
    this.idFactory = idFactory ?? (() => `map-${randomUUID()}`);
    this.audit = audit;
  }

  #assertEnabled() {
    if (!this.enabled) {
      throw new IntelligenceError('FEATURE_DISABLED', 'E3I Intelligence is disabled', 503);
    }
  }

  #audit(action, context, resourceId, result) {
    this.audit({
      action,
      tenantId: context.tenantId,
      actorId: context.actorId,
      resourceType: 'MAPPING',
      resourceId,
      result,
      occurredAt: this.clock().toISOString(),
    });
  }

  createMapping(context, input = {}) {
    this.#assertEnabled();
    const auth = assertContext(context, PERMISSIONS.WRITE);
    assertNoClientTenant(input);

    const mappingType = requireText(input.mappingType, 'mappingType', 80);
    if (!ALLOWED_MAPPING_TYPES.has(mappingType)) {
      throw new IntelligenceError('VALIDATION_ERROR', 'Invalid mappingType');
    }

    const timestamp = this.clock().toISOString();
    const mapping = {
      mappingId: this.idFactory(),
      tenantId: auth.tenantId,
      name: requireText(input.name, 'name', 200),
      ...(String(input.description ?? '').trim() ? { description: String(input.description).trim().slice(0, 4000) } : {}),
      mappingType,
      status: 'DRAFT',
      sources: ['USER_INTERVIEW'],
      activities: [],
      facts: [],
      riskRefs: [],
      opportunityRefs: [],
      evidenceRefs: [],
      createdByActorId: auth.actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const saved = this.repository.save(mapping);
    this.#audit('MAPPING_CREATED', auth, mapping.mappingId, 'SUCCESS');
    return saved;
  }

  getMapping(context, mappingId) {
    this.#assertEnabled();
    const auth = assertContext(context, PERMISSIONS.READ);
    const id = requireText(mappingId, 'mappingId', 180);
    const mapping = this.repository.get(auth.tenantId, id);
    if (!mapping) throw new IntelligenceError('NOT_FOUND', 'Mapping not found', 404);
    this.#audit('MAPPING_READ', auth, id, 'SUCCESS');
    return mapping;
  }

  listMappings(context) {
    this.#assertEnabled();
    const auth = assertContext(context, PERMISSIONS.READ);
    const mappings = this.repository.list(auth.tenantId);
    this.#audit('MAPPING_LISTED', auth, '*', 'SUCCESS');
    return mappings;
  }

  addHumanActivity(context, mappingId, input = {}) {
    this.#assertEnabled();
    const auth = assertContext(context, PERMISSIONS.WRITE);
    assertNoClientTenant(input);
    const mapping = this.repository.get(auth.tenantId, requireText(mappingId, 'mappingId', 180));
    if (!mapping) throw new IntelligenceError('NOT_FOUND', 'Mapping not found', 404);

    const timestamp = this.clock().toISOString();
    const activity = {
      activityId: `act-${randomUUID()}`,
      name: requireText(input.name, 'activity.name', 240),
      ...(String(input.description ?? '').trim() ? { description: String(input.description).trim().slice(0, 4000) } : {}),
      ...(String(input.role ?? '').trim() ? { role: String(input.role).trim().slice(0, 160) } : {}),
      ...(String(input.system ?? '').trim() ? { system: String(input.system).trim().slice(0, 160) } : {}),
      provenance: buildHumanProvenance({ actorId: auth.actorId, policy: input.provenancePolicy, now: timestamp }),
    };

    for (const field of ['frequencyPerMonth', 'workMinutesPerOccurrence', 'waitMinutesPerOccurrence', 'hourlyCost']) {
      if (input[field] !== undefined) {
        const number = Number(input[field]);
        if (!Number.isFinite(number) || number < 0) {
          throw new IntelligenceError('VALIDATION_ERROR', `${field} must be a non-negative number`);
        }
        activity[field] = number;
      }
    }

    if (input.reworkRate !== undefined) {
      const rate = Number(input.reworkRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new IntelligenceError('VALIDATION_ERROR', 'reworkRate must be between 0 and 1');
      }
      activity.reworkRate = rate;
    }

    if (input.currency !== undefined) {
      const currency = String(input.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new IntelligenceError('VALIDATION_ERROR', 'currency must be ISO-4217 style');
      activity.currency = currency;
    }

    mapping.activities.push(activity);
    mapping.updatedAt = timestamp;
    const saved = this.repository.save(mapping);
    this.#audit('MAPPING_ACTIVITY_ADDED', auth, mapping.mappingId, 'SUCCESS');
    return saved;
  }

  addHumanFact(context, mappingId, input = {}) {
    this.#assertEnabled();
    const auth = assertContext(context, PERMISSIONS.WRITE);
    assertNoClientTenant(input);
    const mapping = this.repository.get(auth.tenantId, requireText(mappingId, 'mappingId', 180));
    if (!mapping) throw new IntelligenceError('NOT_FOUND', 'Mapping not found', 404);
    if (!Object.prototype.hasOwnProperty.call(input, 'value')) {
      throw new IntelligenceError('VALIDATION_ERROR', 'fact.value is required');
    }

    const timestamp = this.clock().toISOString();
    const fact = {
      key: requireText(input.key, 'fact.key', 160),
      value: clone(input.value),
      ...(String(input.unit ?? '').trim() ? { unit: String(input.unit).trim().slice(0, 60) } : {}),
      provenance: buildHumanProvenance({ actorId: auth.actorId, policy: input.provenancePolicy, now: timestamp }),
    };

    mapping.facts.push(fact);
    mapping.updatedAt = timestamp;
    const saved = this.repository.save(mapping);
    this.#audit('MAPPING_FACT_ADDED', auth, mapping.mappingId, 'SUCCESS');
    return saved;
  }
}
