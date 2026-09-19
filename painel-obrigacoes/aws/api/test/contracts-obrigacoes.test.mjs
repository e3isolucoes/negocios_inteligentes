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
