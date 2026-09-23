import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeadlineAlerts, escapeHtml, itemsHtml, recipientsForAlerts } from '../scripts/alertas-core.mjs';

const obligation = {
  id: 'ob-1', name: '<Fechamento>', frequency: 'pontual', due_date: '2026-08-29',
  responsible: 'Ana', responsible_id: 'owner', workspace_id: 'workspace-a', module_key: 'financeiro',
};

test('alertas usam a data ajustada da ocorrência', () => {
  const alerts = collectDeadlineAlerts({
    obligations: [obligation], completions: [], holidays: [], daysAhead: 5,
    overrides: [{ obligation_id: 'ob-1', original_date: '2026-08-29', override_date: '2026-08-30' }],
    now: new Date('2026-08-27T12:00:00-03:00'),
  });
  assert.equal(alerts[0].occurrence.toISOString().slice(0, 10), '2026-08-30');
  assert.match(itemsHtml(alerts), /data ajustada/);
});

test('destinatários ficam isolados por empresa e módulo', () => {
  const alerts = [{ ob: obligation }];
  const profiles = [
    { id: 'owner', email: 'ana@example.com', workspace_id: 'workspace-a', role: 'membro', active: true },
    { id: 'manager', email: 'gestor@example.com', workspace_id: 'workspace-a', role: 'gestor', module_access: ['financeiro'], active: true },
    { id: 'wrong-module', email: 'rh@example.com', workspace_id: 'workspace-a', role: 'gestor', module_access: ['rh'], active: true },
    { id: 'wrong-workspace', email: 'outro@example.com', workspace_id: 'workspace-b', role: 'admin', active: true },
  ];
  const recipients = recipientsForAlerts({ alerts, profiles });
  assert.deepEqual([...recipients.responsible.keys()], ['owner']);
  assert.deepEqual([...recipients.managers.keys()], ['manager']);
});

test('conteúdo vindo do banco é escapado no e-mail', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.doesNotMatch(itemsHtml([{ ob: obligation, occurrence: new Date('2026-08-29'), status: { tone: 'amber' } }]), /<Fechamento>/);
});
