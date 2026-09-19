export const GENERIC_SCHEMA_VERSION = 2;
export const MEMBER_INDEX = 'GSI1';
export const RECORD_LOOKUP_INDEX = 'GSI-RECORD-LOOKUP';
export const DUEDATE_INDEX = 'GSI-DUEDATE';

const IDENTIFIER = /^[a-zA-Z0-9_.:@+-]{1,200}$/;
const WORKSPACE_IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function assertWorkspaceId(workspaceId) {
  const value = String(workspaceId || '');
  if (!WORKSPACE_IDENTIFIER.test(value)) {
    throw Object.assign(new Error('workspace_id inválido.'), { statusCode: 400 });
  }
  return value;
}

export function assertIdentifier(value, label = 'identificador') {
  const normalized = String(value || '');
  if (!IDENTIFIER.test(normalized)) {
    throw Object.assign(new Error(`${label} inválido.`), { statusCode: 400 });
  }
  return normalized;
}

export function normalizeDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  if (!DATE_ONLY.test(normalized)) {
    throw Object.assign(new Error('dueDate inválida. Use yyyy-mm-dd.'), { statusCode: 400 });
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw Object.assign(new Error('dueDate inválida. Use yyyy-mm-dd.'), { statusCode: 400 });
  }
  return normalized;
}

export function normalizeTimestamp(value = new Date().toISOString()) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('timestamp inválido.'), { statusCode: 400 });
  }
  return parsed.toISOString();
}

export function workspacePk(workspaceId) {
  return `WORKSPACE#${assertWorkspaceId(workspaceId)}`;
}

export function workspaceMetadataSk() {
  return 'METADATA';
}

export function memberSk(cognitoSub) {
  return `MEMBER#${assertIdentifier(cognitoSub, 'cognitoSub')}`;
}

export function moduleSk(moduleId) {
  return `MODULE#${assertIdentifier(moduleId, 'moduleId')}`;
}

export function entitlementSk(moduleId) {
  return `ENTITLEMENT#${assertIdentifier(moduleId, 'moduleId')}`;
}

export function recordSk(moduleId, recordType, recordId) {
  return `RECORD#${assertIdentifier(moduleId, 'moduleId')}#${assertIdentifier(recordType, 'recordType')}#${assertIdentifier(recordId, 'recordId')}`;
}

export function relationSk(recordId, relatedRecordId) {
  return `RELATION#${assertIdentifier(recordId, 'recordId')}#${assertIdentifier(relatedRecordId, 'relatedRecordId')}`;
}

export function eventSk(timestamp, eventId) {
  return `EVENT#${normalizeTimestamp(timestamp)}#${assertIdentifier(eventId, 'eventId')}`;
}

export function insightSk(moduleId, insightId) {
  return `INSIGHT#${assertIdentifier(moduleId, 'moduleId')}#${assertIdentifier(insightId, 'insightId')}`;
}

export function memberIndexKeys(workspaceId, cognitoSub) {
  return {
    GSI1PK: `MEMBER#${assertIdentifier(cognitoSub, 'cognitoSub')}`,
    GSI1SK: workspacePk(workspaceId),
  };
}

export function relationLookupKeys(recordId, relatedRecordId) {
  return {
    GSIRecordPK: `RECORD#${assertIdentifier(recordId, 'recordId')}`,
    GSIRecordSK: `RELATION#${assertIdentifier(relatedRecordId, 'relatedRecordId')}`,
  };
}

export function dueDateIndexKeys(workspaceId, dueDate, recordId) {
  const normalizedDueDate = normalizeDateOnly(dueDate);
  if (!normalizedDueDate) return {};
  return {
    GSIDueDatePK: `${workspacePk(workspaceId)}#DUEDATE`,
    GSIDueDateSK: `${normalizedDueDate}#${assertIdentifier(recordId, 'recordId')}`,
  };
}
