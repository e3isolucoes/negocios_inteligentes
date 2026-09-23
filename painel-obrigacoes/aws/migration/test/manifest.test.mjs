import assert from 'node:assert/strict';
import test from 'node:test';
import { buildItems, canonicalJson, classifyExtras, classifyTarget, contentHash, createManifest, diffManifests, validateManifest } from '../manifest.mjs';

const config = { toolId: 'painel', appEnv: 'test' };
const empty = () => ({ workspaces: [], profiles: [], companies: [], obligations: [], completions: [], obligation_comments: [], audit_log: [], holidays: [], checklist_items: [], obligation_rules: [], obligation_date_overrides: [], tax_regimes: [], tax_regime_rules: [], categories: [] });

test('JSON canônico independe da ordem e detecta diferença de um campo/byte', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(contentHash({ value: 'abc' }), contentHash({ value: 'abd' }));
  assert.equal(contentHash({ PK: 'x', SK: 'y', migratedAt: 'ontem', value: 1 }), contentHash({ PK: 'z', SK: 'w', migratedAt: 'hoje', value: 1 }));
});

test('rerun é unchanged e alteração no destino é conflito', () => {
  const current = { contentHash: contentHash({ value: 1 }) };
  assert.equal(classifyTarget({ value: 1 }, current), 'unchanged');
  assert.equal(classifyTarget({ value: 2 }, current), 'conflict');
  assert.equal(classifyTarget({ value: 1 }, { contentHash: contentHash({ value: 2 }) }, current), 'update');
});

test('freeze detecta insert, update e delete sem high-water mark', () => {
  const item = (SK, hash) => ({ targetKey: { PK: 'P', SK }, contentHash: hash });
  const delta = diffManifests({ items: [item('deleted', 'a'), item('updated', 'a')] }, { items: [item('inserted', 'b'), item('updated', 'b')] });
  assert.equal(delta.inserted.length, 1); assert.equal(delta.updated.length, 1); assert.equal(delta.deleted.length, 1);
});

test('transforma attachment_path antes do hash', () => {
  const rows = empty(); rows.completions.push({ id: 'c1', workspace_id: 'w1', attachment_path: '/docs/a.pdf' });
  const built = buildItems(config, rows); assert.equal(built[0].item.attachment_path, 'painel/test/w1/legacy/docs/a.pdf');
  assert.equal(built[0].manifest.contentHash, contentHash(built[0].item));
});

test('inclui profile, membership e cobertura administrativa', () => {
  const rows = empty(); rows.workspaces.push({ id: 'w1' }); rows.profiles.push({ id: 'u1', workspace_id: 'w1', role: 'membro' }, { id: 'admin', role: 'super_admin' });
  const entities = buildItems(config, rows).map(({ manifest }) => manifest.entity);
  assert.deepEqual(entities.sort(), ['administrative_workspace', 'membership', 'profiles', 'profiles', 'workspaces'].sort());
});

test('tax_regime_rules herda workspace sem inventar updated_at', () => {
  const rows = empty(); rows.tax_regimes.push({ id: 'r1', workspace_id: 'w1' }); rows.tax_regime_rules.push({ tax_regime_id: 'r1', obligation_rule_id: 'o1' });
  const record = buildItems(config, rows).find(({ manifest }) => manifest.entity === 'tax_regime_rules');
  assert.equal(record.manifest.workspace, 'w1'); assert.equal('updated_at' in record.item, false);
});

test('manifesto contém somente metadados de prova, sem conteúdo sensível', () => {
  const rows = empty(); rows.profiles.push({ id: 'admin', role: 'super_admin', email: 'secret@example.test' });
  const text = JSON.stringify(createManifest(config, buildItems(config, rows)));
  assert.doesNotMatch(text, /secret@example/); assert.match(text, /contentHash/);
});

test('extra é classificado e somente allowlist explícita o aprova', () => {
  const keys = ['P\u0000COMPANY#extra'];
  assert.equal(classifyExtras(keys, [])[0].classification, 'unapproved');
  assert.equal(classifyExtras(keys, [{ PK: 'P', SK: 'COMPANY#extra' }])[0].classification, 'allowlisted');
});

test('rejeita manifesto adulterado, duplicado ou de outro ambiente', () => {
  const rows = empty(); rows.workspaces.push({ id: 'w1' });
  const manifest = createManifest(config, buildItems(config, rows));
  assert.equal(validateManifest(manifest, config), manifest);
  assert.throws(() => validateManifest({ ...manifest, environment: 'prod' }, config), /outra ferramenta ou ambiente/);
  assert.throws(() => validateManifest({ ...manifest, items: [{ ...manifest.items[0], contentHash: 'adulterado' }] }, config), /SHA-256 inválido/);
  assert.throws(() => validateManifest({ ...manifest, items: [manifest.items[0], manifest.items[0]] }, config), /duplicada/);
  const { workspace, ...withoutWorkspace } = manifest.items[0];
  assert.throws(() => validateManifest({ ...manifest, items: [withoutWorkspace] }, config), /entrada incompleta/);
});
