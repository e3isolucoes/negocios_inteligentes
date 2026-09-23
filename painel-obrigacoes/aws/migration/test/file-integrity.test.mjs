import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { buildInventory, compareObject, migrateReference, sha256, withRetry } from '../file-integrity.mjs';

const config = { toolId: 'painel', appEnv: 'test' };
const source = (text = 'conteudo') => {
  const bytes = new TextEncoder().encode(text);
  return { bytes, size: bytes.byteLength, hash: sha256(bytes), contentType: 'application/pdf' };
};

test('mesmo nome em workspaces diferentes gera paths tenant-scoped distintos', () => {
  const { references, invalid } = buildInventory(config, [
    { id: 'c1', workspace_id: 'empresa-a', attachment_path: 'comprovante.pdf' },
    { id: 'c2', workspace_id: 'empresa-b', attachment_path: '/comprovante.pdf' }
  ]);
  assert.equal(invalid.length, 0);
  assert.deepEqual(references.map((item) => item.targetPath), [
    'painel/test/empresa-a/legacy/comprovante.pdf', 'painel/test/empresa-b/legacy/comprovante.pdf'
  ]);
});

test('inventário não omite referência inválida e detecta colisão', () => {
  const result = buildInventory(config, [
    { id: 'sem-workspace', attachment_path: 'a.pdf' },
    { id: 'c1', workspace_id: 'w1', attachment_path: 'a.pdf' },
    { id: 'c2', workspace_id: 'w1', attachment_path: 'a.pdf' }
  ]);
  assert.deepEqual(result.invalid.map((item) => item.reason), ['invalid_completion_reference', 'target_path_collision']);
});

test('inventário rejeita componente de workspace que escaparia do tenant', () => {
  const result = buildInventory(config, [{ id: 'c1', workspace_id: '../empresa-b', attachment_path: 'a.pdf' }]);
  assert.equal(result.invalid[0].reason, 'invalid_completion_reference');
});

test('retry repete falha transitória e preserva resultado', async () => {
  let calls = 0;
  const value = await withRetry(async () => { if (++calls < 3) throw Object.assign(new Error('temporário'), { status: 503 }); return 'ok'; }, { delay: async () => {} });
  assert.equal(value, 'ok'); assert.equal(calls, 3);
});

test('arquivo existente parcialmente migrado falha sem sobrescrever', async () => {
  const expected = source('conteudo-completo'); let puts = 0;
  const s3 = { send: async (command) => {
    if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from([Buffer.from('parc')]), ContentLength: 4, ContentType: 'application/pdf', Metadata: { workspace: 'w1', completion: 'c1', 'source-path': 'a.pdf', sha256: expected.hash } };
    if (command.constructor.name === 'PutObjectCommand') { puts++; return {}; }
    throw new Error('comando inesperado');
  } };
  await assert.rejects(migrateReference({ s3, bucket: 'bucket', config, reference: { completionId: 'c1', workspace: 'w1', sourcePath: 'a.pdf', targetPath: 'painel/test/w1/legacy/a.pdf' }, fetchSource: async () => expected }), /objeto existente diverge/);
  assert.equal(puts, 0);
});

test('comparação cobre tamanho, hash, content-type, workspace, completion e source path', () => {
  const expected = source();
  const differences = compareObject(
    { completionId: 'c1', workspace: 'w1', sourcePath: 'a.pdf' }, expected,
    { bytes: new Uint8Array([1]), size: 2, hash: 'outro', contentType: 'image/png', metadata: { workspace: 'w2', completion: 'c2', 'source-path': 'b.pdf' } }
  );
  assert.deepEqual(differences, ['size', 'sha256', 'content-type', 'workspace', 'completion', 'source-path', 'metadata-sha256']);
});
