import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STATE } from '../js/state.js';
import { withCurrentWorkspace, withCurrentWorkspaceMany } from '../js/api/workspaceContext.js';

test.afterEach(() => { STATE.profile = null; });

test('todo novo registro recebe automaticamente o espaço da empresa autenticada', () => {
  STATE.profile = { workspace_id: 'empresa-123' };

  assert.deepEqual(withCurrentWorkspace({ name: 'Registro' }), {
    name: 'Registro', workspace_id: 'empresa-123',
  });
  assert.deepEqual(withCurrentWorkspaceMany([{ name: 'A' }, { name: 'B' }]), [
    { name: 'A', workspace_id: 'empresa-123' },
    { name: 'B', workspace_id: 'empresa-123' },
  ]);
});

test('não permite criar informações fora de um espaço empresarial', () => {
  assert.throws(
    () => withCurrentWorkspace({ name: 'Registro' }),
    /não está vinculada a um espaço de empresa/,
  );
});

test('todas as APIs de criação operacional usam o vínculo automático centralizado', async () => {
  const modules = [
    'companies.js', 'obligations.js', 'completions.js', 'comments.js', 'checklist.js',
    'holidays.js', 'obligationRules.js', 'occurrenceOverrides.js', 'taxRegimes.js', 'categories.js',
  ];
  for (const module of modules) {
    const source = await readFile(new URL(`../js/api/${module}`, import.meta.url), 'utf8');
    assert.match(source, /withCurrentWorkspace/, `${module} deve aplicar o workspace automaticamente`);
  }
});
