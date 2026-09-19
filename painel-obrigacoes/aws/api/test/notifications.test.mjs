import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAlerts, groupRecipients, html } from '../src/notification-core.mjs';

const obligation = { id: 'o1', entityType: 'obligations', workspace_id: 'w1', name: '<Fechamento>', frequency: 'pontual', due_date: '2026-08-29', responsible_id: 'u1', module_key: 'financeiro' };
const records = [obligation, { id: 'u1', entityType: 'profiles', workspace_id: 'w1', email: 'a@example.com', active: true, role: 'membro' }, { id: 'g1', entityType: 'profiles', workspace_id: 'w1', email: 'g@example.com', active: true, role: 'gestor', module_access: ['financeiro'] }];

test('DynamoDB gera alerta e restringe destinatários ao workspace e módulo', () => {
  const alerts = collectAlerts(records, { now: new Date('2026-08-27T12:00:00-03:00') });
  assert.equal(alerts.length, 1);
  const recipients = groupRecipients([...records, { id: 'g2', entityType: 'profiles', workspace_id: 'w2', email: 'x@example.com', role: 'admin' }], alerts);
  assert.deepEqual([...recipients.owners.keys()], ['u1']);
  assert.deepEqual([...recipients.managers.keys()], ['g1']);
});

test('HTML de dados operacionais é escapado', () => assert.equal(html('<Fechamento>'), '&lt;Fechamento&gt;'));
