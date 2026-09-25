import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('cliente AWS prefere workspace da sessão renovada ao perfil em cache', async () => {
  const source = await readFile(new URL('../js/api/awsDataClient.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /let workspaceId = await getActiveWorkspaceId\(\) \|\| STATE\.profile\?\.workspace_id;/,
  );
  assert.match(
    source,
    /workspaceId = await getActiveWorkspaceId\(\) \|\| STATE\.profile\?\.workspace_id;/,
  );
  assert.doesNotMatch(
    source,
    /STATE\.profile\?\.workspace_id \|\| await getActiveWorkspaceId\(\)/,
  );
});
