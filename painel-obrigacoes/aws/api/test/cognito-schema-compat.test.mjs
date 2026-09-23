import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('template preserva atributo Cognito legado sem remover extensões atuais', async () => {
  const template = await readFile(new URL('../../template.yaml', import.meta.url), 'utf8');

  assert.match(
    template,
    /Name: active_workspace_id[\s\S]{0,180}?AttributeDataType: String[\s\S]{0,120}?Mutable: true[\s\S]{0,180}?MinLength: '1'[\s\S]{0,80}?MaxLength: '80'/,
  );

  // O schema legado é imutável; a arquitetura canônica pode manter
  // PreTokenGeneration/entitlement lifecycle desde que não dependa desse
  // atributo como fonte de autorização.
  assert.match(template, /PreTokenGeneration/);
});

test('autorização canônica continua baseada em membership/entitlements, não no atributo legado', async () => {
  const [auth, model] = await Promise.all([
    readFile(new URL('../src/auth.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/model.mjs', import.meta.url), 'utf8'),
  ]);

  assert.match(auth, /MEMBER_INDEX/);
  assert.match(auth, /memberSk\(userId\)/);
  assert.match(auth, /MEMBER#/);
  assert.doesNotMatch(auth, /active_workspace_id/);
  assert.match(model, /moduleGrants|grant|readGrant|writeGrant/);
});
