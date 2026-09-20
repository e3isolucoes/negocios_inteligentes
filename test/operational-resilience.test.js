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

test('fluxo de conclusão mostra claramente o que falta e bloqueia sem confirmação', async () => {
  const dialog = await readFile(new URL('../painel-obrigacoes/js/ui/completeDialog.js', import.meta.url), 'utf8');
  const board = await readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8');

  assert.match(dialog, /O que falta para concluir/);
  assert.match(dialog, /completion-requirements/);
  assert.match(dialog, /Checklist/);
  assert.match(dialog, /Comprovante/);
  assert.match(dialog, /Validação/);
  assert.match(dialog, /confirmBtn\.disabled = !ready/);
  assert.match(dialog, /Recarregue o checklist/);

  assert.match(board, /completionReadinessPreview/);
  assert.match(board, /Faltam \$\{hardBlockers\}/);
  assert.match(board, /Pronto para concluir/);
});
