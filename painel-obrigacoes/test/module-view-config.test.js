import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { expandEnabledViewIds } from '../js/modules/catalog.js';

test('configuração funcional é traduzida para os IDs reais das telas', () => {
  const enabled = expandEnabledViewIds(['obrigacoes', 'validacoes', 'dashboard', 'relatorios', 'administracao']);
  assert.ok(enabled.includes('board'));
  assert.ok(enabled.includes('mine'));
  assert.ok(enabled.includes('validacoes'));
  assert.ok(enabled.includes('dashboard'));
  assert.ok(enabled.includes('reports'));
  assert.ok(enabled.includes('manage'));
  assert.ok(enabled.includes('access-denied'));
});

test('CSP continua estrita e dependências opcionais não são carregadas no boot', async () => {
  const [configText, index] = await Promise.all([
    readFile(new URL('../staticwebapp.config.json', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  const csp = JSON.parse(configText).globalHeaders['Content-Security-Policy'];
  assert.match(csp, /script-src[^;]*'unsafe-eval'/);
  assert.match(csp, /script-src-elem 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /script-src-elem[^;]*'unsafe-(?:eval|inline)'/);
  assert.doesNotMatch(index, /pdfjs-dist@3\.11\.174/);
  assert.doesNotMatch(index, /xlsx\.full\.min\.js/);
  assert.doesNotMatch(index, /tesseract\.min\.js/);
});
