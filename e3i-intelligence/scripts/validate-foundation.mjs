import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifest = readJson('foundation-manifest.json');
const provenance = readJson('contracts/data-provenance-v1.schema.json');
const evidence = readJson('contracts/evidence-v1.schema.json');
const event = readJson('contracts/event-v1.schema.json');
const mapping = readJson('contracts/mapping-v1.schema.json');
const saving = readJson('contracts/saving-opportunity-v1.schema.json');

assert(manifest.deployment.automatic === false, 'automatic deployment must remain disabled in Sprint 1');
assert(manifest.deployment.featureEnabledByDefault === false, 'feature must default to disabled');
assert(manifest.deployment.ingestionEnabledByDefault === false, 'ingestion must default to disabled');
assert(manifest.deployment.existingToolDependency === false, 'existing tools must not depend on Intelligence');
assert(manifest.guardrails.operationalToolsMustWorkWhenDisabled === true, 'operational independence guardrail missing');
assert(manifest.guardrails.customerDataForModelTraining === false, 'customer model-training default must remain false');
assert(manifest.guardrails.agentsReadOnlyInitially === true, 'agents must remain read-only initially');

for (const [name, schema] of Object.entries({ evidence, event, mapping, saving })) {
  assert(schema.type === 'object', `${name} contract must be an object`);
  assert(schema.additionalProperties === false, `${name} contract must reject undeclared top-level fields`);
  assert(schema.properties?.tenantId, `${name} contract must be tenant-scoped`);
  assert(schema.required?.includes('tenantId'), `${name} must require tenantId`);
}

assert(provenance.required?.includes('processingPurposeId'), 'provenance must require processing purpose');
assert(provenance.required?.includes('dataClassification'), 'provenance must require data classification');
assert(provenance.required?.includes('retentionClass'), 'provenance must require retention class');
assert(provenance.properties?.sourceType?.enum?.includes('USER_DECLARED'), 'provenance must support human complement');
assert(provenance.properties?.sourceType?.enum?.includes('E3I_TOOL_MEASURED'), 'provenance must support tool measurements');
assert(provenance.properties?.sourceType?.enum?.includes('AI_INFERRED'), 'provenance must distinguish AI inference');

const mappingSources = mapping.properties?.sources?.items?.enum || [];
assert(mappingSources.includes('USER_INTERVIEW'), 'mapping must support starting from user interview');
assert(mappingSources.includes('E3I_TOOL'), 'mapping must support enrichment from E3I tools');
assert(mapping.properties?.activities, 'mapping must support activities');
assert(mapping.properties?.facts, 'mapping must support complementary facts');

const savingStatuses = saving.properties?.status?.enum || [];
assert(savingStatuses.includes('VALIDATED'), 'saving lifecycle must include validated state');
assert(savingStatuses.includes('REJECTED'), 'saving lifecycle must support rejection');
assert(saving.properties?.evidenceRefs, 'saving must support evidence references');
assert(saving.properties?.confidence, 'saving must expose confidence');

const privateEvidence = manifest.plannedResources.find((resource) => resource.name === 'EvidenceStore');
assert(privateEvidence?.publicAccess === false, 'evidence storage must not allow public access');

console.log('E3I_INTELLIGENCE_FOUNDATION_VALIDATION_OK');
