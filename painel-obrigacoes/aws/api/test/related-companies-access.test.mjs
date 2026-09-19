import assert from 'node:assert/strict';
import test from 'node:test';
import { GenericRepository } from '../src/repository-generic.mjs';
import { resolveWorkspaceMembership } from '../src/auth.mjs';

test('MEMBER do workspace citado permite leitura somente após seleção normal e entitlement ativo', async () => {
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
  const client = {
    send: async (command) => {
      const key = command.input?.Key;
      if (key?.SK === 'ENTITLEMENT#obrigacoes') {
        return {
          Item: {
            PK: 'WORKSPACE#workspace-b',
            SK: 'ENTITLEMENT#obrigacoes',
            workspace_id: 'workspace-b',
            entityType: 'entitlement',
            moduleId: 'obrigacoes',
            plan: 'standard',
            status: 'ativo',
            startedAt: '2026-09-01T00:00:00.000Z',
            renewsAt: '2026-10-01T00:00:00.000Z',
          },
        };
      }
      if (key?.SK === 'RECORD#obrigacoes#activity#atividade-b') {
        return {
          Item: {
            PK: 'WORKSPACE#workspace-b',
            SK: 'RECORD#obrigacoes#activity#atividade-b',
            workspace_id: 'workspace-b',
            module_id: 'obrigacoes',
            record_type: 'activity',
            record_id: 'atividade-b',
            entityType: 'record',
            name: 'Atividade da empresa B',
          },
        };
      }
      return {};
    },
  };

  const repository = new GenericRepository(client, 'table');
  const record = await repository.getRecord(
    selected.workspaceId,
    'obrigacoes',
    'activity',
    'atividade-b',
  );

  assert.equal(record.workspace_id, 'workspace-b');
  assert.equal(record.name, 'Atividade da empresa B');
});
