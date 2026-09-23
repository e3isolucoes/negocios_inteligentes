const ROLE_ALIASES = Object.freeze({
  member: 'member', membro: 'member',
  manager: 'manager', gestor: 'manager',
  admin: 'admin', administrador: 'admin',
  super_admin: 'super_admin'
});

const COMPLETION_STATUS_ALIASES = Object.freeze({
  aguardando_validacao: 'aguardando_validacao',
  validada: 'validada', validado: 'validada',
  rejeitada: 'rejeitada', rejeitado: 'rejeitada'
});

export const CANONICAL_ROLES = Object.freeze(['member', 'manager', 'admin', 'super_admin']);
export const CANONICAL_COMPLETION_STATUSES = Object.freeze(['aguardando_validacao', 'validada', 'rejeitada']);

export function canonicalRole(value) {
  return typeof value === 'string' ? ROLE_ALIASES[value.trim().toLowerCase()] : undefined;
}

export function canonicalCompletionStatus(value) {
  return typeof value === 'string' ? COMPLETION_STATUS_ALIASES[value.trim()] : undefined;
}

// DynamoDB can contain records copied before the AWS contract was canonicalized.
// Normalize only known compatibility aliases; unknown values remain visible for
// diagnosis instead of being silently relabelled.
export function adaptRecordForRead(record) {
  if (!record) return record;
  if (record.entityType === 'profiles' && canonicalRole(record.role)) {
    return { ...record, role: canonicalRole(record.role) };
  }
  if (record.entityType === 'completions' && canonicalCompletionStatus(record.status)) {
    return { ...record, status: canonicalCompletionStatus(record.status) };
  }
  if (record.entityType === 'checklist_items' && record.completed === undefined && typeof record.done === 'boolean') {
    return { ...record, completed: record.done };
  }
  return record;
}
