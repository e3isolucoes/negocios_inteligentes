import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipItem, normalizeRole } from '../shared.mjs';

const config = { toolId: 'painel-obrigacoes', appEnv: 'staging' };

test('normaliza os papéis legados para a autorização AWS', () => {
  assert.equal(normalizeRole('membro'), 'member');
  assert.equal(normalizeRole('gestor'), 'manager');
  assert.equal(normalizeRole('admin'), 'admin');
});

test('membership preserva empresa e usa papel normalizado', () => {
  const item = membershipItem(config, {
    id: 'usuario-1', workspace_id: 'empresa-1', role: 'membro', active: true
  });
  assert.equal(item.role, 'member');
  assert.equal(item.workspaceId, 'empresa-1');
  assert.match(item.PK, /USER#usuario-1$/);
});
