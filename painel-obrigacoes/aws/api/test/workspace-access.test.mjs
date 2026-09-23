import assert from 'node:assert/strict';
import test from 'node:test';
import { requireWorkspaceAvailable } from '../src/workspace-access.mjs';

test('full e trial vigente autorizam; suspended e trial expirado negam imediatamente', () => {
  assert.doesNotThrow(() => requireWorkspaceAvailable({ access_status: 'full' }, '2026-09-09'));
  assert.doesNotThrow(() => requireWorkspaceAvailable({ access_status: 'trial', trial_ends_at: '2026-09-09' }, '2026-09-09'));
  assert.throws(() => requireWorkspaceAvailable({ access_status: 'suspended' }, '2026-09-09'), { statusCode: 403 });
  assert.throws(() => requireWorkspaceAvailable({ access_status: 'trial', trial_ends_at: '2026-09-08' }, '2026-09-09'), { statusCode: 403 });
});
