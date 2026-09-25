import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('template preserva atributo Cognito legado e mantém arquitetura atual', async () => {
  const template = await readFile(new URL('../../template.yaml', import.meta.url), 'utf8');

  assert.match(
    template,
    /Name: active_workspace_id[\s\S]{0,180}?AttributeDataType: String[\s\S]{0,120}?Mutable: true[\s\S]{0,180}?MinLength: '1'[\s\S]{0,80}?MaxLength: '80'/,
  );
  assert.match(template, /PreTokenGenerationFunction:/);
  assert.match(template, /PreTokenGenerationConfig:/);
});

test('autorização atual preserva claims canônicos e usa atributo legado somente como seletor compatível', async () => {
  const [auth, workspaceAccess] = await Promise.all([
    readFile(new URL('../src/auth.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/workspace-access.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(auth, /custom:workspace_id/);
  assert.match(auth, /custom:active_workspace_id/);
  assert.match(auth, /resolveWorkspaceMembership/);
  assert.match(auth, /resolveLegacyCognitoAuthorization/);
  assert.match(auth, /MEMBER#/);
  assert.match(auth, /MEMBER_INDEX/);
  assert.match(auth, /papel e grants são relidos do MEMBER canônico|role: membership\.role/);
  assert.match(workspaceAccess, /access_status === 'suspended'/);
  assert.match(workspaceAccess, /access_status === 'trial'/);
  assert.match(workspaceAccess, /trial_ends_at/);
});
