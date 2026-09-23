import assert from 'node:assert/strict';
import test from 'node:test';
import { createDownloadUrl } from '../src/files.mjs';

const auth = { workspaceId: 'empresa-a', modules: ['obrigacoes'], role: 'member' };

test('download assinado rejeita mesmo nome pertencente a outro workspace', async () => {
  await assert.rejects(
    createDownloadUrl({}, 'bucket', auth, 'painel-obrigacoes/prod/empresa-b/legacy/comprovante.pdf'),
    (error) => error.statusCode === 403 && /fora da empresa/.test(error.message)
  );
});
