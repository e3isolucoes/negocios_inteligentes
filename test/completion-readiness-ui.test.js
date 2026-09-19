import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('conclusão mostra requisitos visuais claros antes de salvar', async () => {
  const dialog = await readFile(new URL('../painel-obrigacoes/js/ui/completeDialog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../painel-obrigacoes/css/styles.css', import.meta.url), 'utf8');

  for (const marker of [
    'completion-readiness',
    'completion-requirement',
    'completion-blockers',
    'O que falta para concluir',
    'Checklist',
    'Comprovante',
    'Validação',
    'Conferência do comprovante',
  ]) {
    assert.ok(dialog.includes(marker), 'marcador de prontidão ausente: ' + marker);
  }

  assert.match(dialog, /checklistUnavailable/);
  assert.match(dialog, /validatorReady/);
  assert.match(dialog, /confirmBtn\.disabled = !ready/);
  assert.match(css, /\.completion-requirement\.is-ready/);
  assert.match(css, /\.completion-blockers\.is-ready/);
});

test('fluxo não ignora falha ao carregar checklist e preserva mensagem específica do backend', async () => {
  const data = await readFile(new URL('../painel-obrigacoes/js/data.js', import.meta.url), 'utf8');

  assert.doesNotMatch(data, /Falha ao carregar checklist, seguindo sem ele/);
  assert.match(data, /checklistUnavailable = true/);
  assert.match(data, /status >= 400 && status < 500/);
  assert.match(data, /showToast\(err\?\.message/);
  assert.doesNotMatch(data, /A Gestão precisa definir quem validará esta tarefa antes do envio\.'[\s\S]{0,50}return;/);
});
