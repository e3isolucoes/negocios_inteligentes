import assert from 'node:assert/strict';
import test from 'node:test';
import { deletionHandler, processDeletion } from '../src/deletion-worker.mjs';

const event = { id: 'event-a', PK: 'tenant-a', entity_sk: 'COMPLETION#a', entity: 'completions', entity_id: 'a', obligation_id: 'o', occurrence_date: '2026-09-01', attachment_path: 'file.pdf' };

function dependencies({ failS3 = false } = {}) {
  let item = { PK: event.PK, SK: event.entity_sk, deletion_event_id: event.id };
  const calls = { s3: 0, transactions: 0 };
  return {
    calls,
    ddb: { send: async command => {
      if (command.input.Key) return { Item: item };
      calls.transactions += 1;
      item = undefined;
      return {};
    } },
    s3: { send: async () => { calls.s3 += 1; if (failS3) throw new Error('s3 unavailable'); return {}; } },
    tableName: 'table', bucket: 'bucket'
  };
}

test('falha no S3 mantém registro pendente e devolve falha parcial para nova tentativa', async () => {
  const deps = dependencies({ failS3: true });
  const result = await deletionHandler(deps)({ Records: [{ messageId: 'message-a', body: JSON.stringify(event) }] });
  assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: 'message-a' }] });
  assert.equal(deps.calls.transactions, 0);
});

test('repetição do evento é idempotente depois da finalização', async () => {
  const deps = dependencies();
  assert.deepEqual(await processDeletion(deps, event), { deleted: true });
  assert.deepEqual(await processDeletion(deps, event), { duplicate: true });
  assert.equal(deps.calls.s3, 1);
  assert.equal(deps.calls.transactions, 1);
});

test('objeto já inexistente é tratado como exclusão bem-sucedida', async () => {
  const deps = dependencies(); // DeleteObject do S3 retorna sucesso também para uma chave ausente.
  assert.deepEqual(await processDeletion(deps, event), { deleted: true });
  assert.equal(deps.calls.transactions, 1);
});
