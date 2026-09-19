import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const contracts = [
  'activity.schema.json',
  'occurrence.schema.json',
  'checklist-item.schema.json',
  'evidence.schema.json',
];

for (const file of contracts) {
  test(`${file} é JSON Schema 2020-12 e exige provenance`, async () => {
    const path = new URL(`../../../../modules/obrigacoes/contracts/${file}`, import.meta.url);
    const schema = JSON.parse(await readFile(path, 'utf8'));

    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.ok(schema.required.includes('provenance'));
    assert.equal(schema.properties.provenance.type, 'object');
    assert.ok(schema.properties.provenance.required.includes('captured_at'));
    assert.ok(schema.properties.provenance.required.includes('origin'));
  });
}

test('contrato genérico de RECORD define relatedCompanies somente como metadado', async () => {
  const path = new URL('../../../../modules/contracts/record.schema.json', import.meta.url);
  const schema = JSON.parse(await readFile(path, 'utf8'));
  const related = schema.properties.relatedCompanies;

  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(related.type, 'array');
  assert.deepEqual(related.items.required, ['workspaceId', 'razaoSocial', 'cnpj']);
  assert.match(related.description, /não concede/i);
});

test('activity expõe relatedCompanies no contrato do módulo obrigações', async () => {
  const path = new URL('../../../../modules/obrigacoes/contracts/activity.schema.json', import.meta.url);
  const schema = JSON.parse(await readFile(path, 'utf8'));

  assert.equal(schema.properties.relatedCompanies.type, 'array');
  assert.equal(schema.properties.relatedCompanies.items.properties.workspaceId.type, 'string');
});
