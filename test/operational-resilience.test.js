import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('cliente AWS renova sessão uma vez antes de falhar por 401', async () => {
  const source = await readFile(new URL('../painel-obrigacoes/js/api/awsDataClient.js', import.meta.url), 'utf8');
  assert.match(source, /refreshAccessToken/);
  assert.match(source, /response\.status === 401 && !authRetried/);
  assert.match(source, /code: 'session_expired'/);
  assert.match(source, /code: 'service_unreachable'/);
});

test('sessão Cognito usa cookie HttpOnly e refresh single-flight', async () => {
  const source = await readFile(new URL('../painel-obrigacoes/js/api/auth.js', import.meta.url), 'utf8');
  assert.match(source, /credentials: 'include'/);
  assert.match(source, /session\/refresh/);
  assert.match(source, /session\/login/);
  assert.match(source, /browserRefreshPromise/);
  assert.match(source, /refreshBrowserSession/);
});

test('fluxo de conclusão continua orientando exatamente o que falta', async () => {
  const dialog = await readFile(new URL('../painel-obrigacoes/js/ui/completeDialog.js', import.meta.url), 'utf8');
  const board = await readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8');

  assert.match(dialog, /O que falta para concluir/);
  assert.match(dialog, /Checklist/);
  assert.match(dialog, /Comprovante/);
  assert.match(dialog, /Validação/);
  assert.match(dialog, /confirmBtn\.disabled = !ready/);
  assert.match(dialog, /Recarregue o checklist/);

  assert.match(board, /completionReadinessPreview/);
  assert.match(board, /Pronto para concluir/);
});


test('falhas operacionais não são confundidas com falta de permissão', async () => {
  const app = await readFile(new URL('../painel-obrigacoes/js/app.js', import.meta.url), 'utf8');
  const data = await readFile(new URL('../painel-obrigacoes/js/data.js', import.meta.url), 'utf8');

  assert.match(app, /isSessionExpiredError/);
  assert.match(app, /isConnectivityError/);
  assert.match(app, /recoverExpiredSession/);
  assert.match(app, /renderOperationalRetry/);
  assert.match(app, /if \(isSessionExpiredError\(error\)\)/);
  assert.match(app, /if \(isConnectivityError\(error\)\)/);
  assert.match(data, /service_unreachable/);
  assert.match(data, /session_expired/);
  assert.match(data, /temporariamente indisponível/);
});

test('refresh 401 sempre vira sessão expirada tratável pela interface', async () => {
  const client = await readFile(new URL('../painel-obrigacoes/js/api/awsDataClient.js', import.meta.url), 'utf8');

  assert.match(client, /try \{[\s\S]*?accessToken = await refreshAccessToken\(\)/);
  assert.match(client, /catch \(cause\)[\s\S]*?code: 'session_expired'/);
});

test('assets operacionais usam uma única versão e recuperação de senha está em form', async () => {
  const [index, app, render] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/render.js', import.meta.url), 'utf8'),
  ]);

  assert.match(index, /id="resetPasswordForm"/);
  assert.match(index, /id="newPasswordInput"[\s\S]*?type="password"/);
  assert.equal((index.match(/20260920-canonical-v1/g) || []).length, 3);
  assert.doesNotMatch(index, /20260919-consolidated-v1/);
  assert.doesNotMatch(app, /20260919-consolidated-v1/);
  assert.doesNotMatch(render, /20260919-consolidated-v1/);
});


test('PDF.js respeita CSP sem unsafe-eval e é carregado apenas sob demanda', async () => {
  const [index, ocr, swa] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/ocr.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/staticwebapp.config.json', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(index, /pdfjs-dist@3\.11\.174/);
  assert.doesNotMatch(index, /pdf\.min\.js/);
  assert.match(ocr, /PDFJS_VERSION = '6\.3\.289'/);
  assert.match(ocr, /import\(PDFJS_MODULE_URL\)/);
  assert.match(ocr, /pdf\.worker\.mjs/);
  assert.doesNotMatch(swa, /'unsafe-eval'/);
  assert.match(swa, /'wasm-unsafe-eval'/);
});
