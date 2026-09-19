import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUEDATE_INDEX,
  MEMBER_INDEX,
  RECORD_LOOKUP_INDEX,
  dueDateIndexKeys,
  entitlementSk,
  eventSk,
  insightSk,
  memberIndexKeys,
  memberSk,
  moduleSk,
  recordSk,
  relationLookupKeys,
  relationSk,
  workspaceMetadataSk,
  workspacePk,
} from '../src/model-generic.mjs';

test('modelo genérico materializa exatamente as chaves da plataforma', () => {
  assert.equal(workspacePk('empresa-a'), 'WORKSPACE#empresa-a');
  assert.equal(workspaceMetadataSk(), 'METADATA');
  assert.equal(memberSk('sub-123'), 'MEMBER#sub-123');
  assert.equal(moduleSk('crm'), 'MODULE#crm');
  assert.equal(entitlementSk('crm'), 'ENTITLEMENT#crm');
  assert.equal(recordSk('crm', 'lead', 'r1'), 'RECORD#crm#lead#r1');
  assert.equal(relationSk('r1', 'r2'), 'RELATION#r1#r2');
  assert.equal(
    eventSk('2026-09-18T12:00:00Z', 'ev-1'),
    'EVENT#2026-09-18T12:00:00.000Z#ev-1',
  );
  assert.equal(insightSk('crm', 'ins-1'), 'INSIGHT#crm#ins-1');
});

test('GSI1 de membros aponta MEMBER para WORKSPACE', () => {
  assert.equal(MEMBER_INDEX, 'GSI1');
  assert.deepEqual(memberIndexKeys('empresa-a', 'sub-123'), {
    GSI1PK: 'MEMBER#sub-123',
    GSI1SK: 'WORKSPACE#empresa-a',
  });
});

test('índices genéricos seguem o contrato de lookup e vencimento', () => {
  assert.equal(RECORD_LOOKUP_INDEX, 'GSI-RECORD-LOOKUP');
  assert.equal(DUEDATE_INDEX, 'GSI-DUEDATE');

  assert.deepEqual(relationLookupKeys('r1', 'r2'), {
    GSIRecordPK: 'RECORD#r1',
    GSIRecordSK: 'RELATION#r2',
  });

  assert.deepEqual(dueDateIndexKeys('empresa-a', '2026-10-15', 'r1'), {
    GSIDueDatePK: 'WORKSPACE#empresa-a#DUEDATE',
    GSIDueDateSK: '2026-10-15#r1',
  });
});

test('data de vencimento inválida é rejeitada em vez de sofrer rollover', () => {
  assert.throws(
    () => dueDateIndexKeys('empresa-a', '2026-02-31', 'r1'),
    /dueDate inválida/,
  );
});
