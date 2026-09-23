import assert from 'node:assert/strict';
import test from 'node:test';
import { localChecklistSuggestions, suggestChecklist } from '../js/checklistSuggestions.js';

const obligation = { id: 'target', name: 'DCTFWeb mensal', category: 'federal', frequency: 'mensal' };
const obligations = [obligation, { id: 'similar', name: 'DCTFWeb matriz', category: 'federal' }, { id: 'other', name: 'ISS municipal', category: 'municipal' }];
const items = [{ obligation_id: 'similar', description: 'Conferir fechamento da folha' }, { obligation_id: 'other', description: 'Conferir notas de serviço' }];
const authenticated = { accessTokenProvider: async () => 'test-token', workspaceIdProvider: () => 'workspace-1' };

test('recommender ranks checklist knowledge from similar obligations first', () => {
  const result = localChecklistSuggestions(obligation, obligations, items);
  assert.equal(result[0].description, 'Conferir fechamento da folha');
  assert.equal(result[0].origin, 'Histórico da equipe');
  assert.ok(result.some((item) => item.description.includes('prazo oficial')));
});

test('recommender falls back locally when the AI endpoint is unavailable', async () => {
  const result = await suggestChecklist(obligation, obligations, items, {
    fetchImpl: async () => { throw new Error('offline'); }, ...authenticated,
  });
  assert.equal(result.mode, 'Modelo local');
  assert.ok(result.suggestions.length >= 5);
});

test('recommender accepts structured suggestions from the server', async () => {
  const fetchImpl = async (_url, options) => {
    assert.equal(JSON.parse(options.body).obligation.name, obligation.name);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.headers['x-workspace-id'], 'workspace-1');
    assert.equal('historicalExamples' in JSON.parse(options.body), false);
    return { ok: true, json: async () => ({ suggestions: [{ description: 'Validar recibo', origin: 'IA' }], mode: 'LLM', sources: [] }) };
  };
  const result = await suggestChecklist(obligation, obligations, items, { fetchImpl, ...authenticated });
  assert.equal(result.mode, 'LLM');
  assert.equal(result.suggestions[0].description, 'Validar recibo');
});

test('recommender não mascara falha de autenticação como fallback local', async () => {
  await assert.rejects(
    suggestChecklist(obligation, obligations, items, {
      ...authenticated,
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    (error) => error.authenticationFailure === true && error.status === 401,
  );
});

test('recommender prioritizes the exact Sankhya spreadsheet model when available', () => {
  const exact = { id: 'dctf', name: 'DCTFWeb', category: 'federal', frequency: 'mensal' };
  const result = localChecklistSuggestions(exact, [exact], []);
  assert.equal(result.length >= 12, true);
  assert.match(result[0].origin, /Modelo Sankhya/);
  assert.match(result[0].description, /Planejamento/);
});
