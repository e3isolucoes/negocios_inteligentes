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

test('fluxo não ignora falha de checklist e preserva erro específico do backend', async () => {
  const data = await readFile(new URL('../painel-obrigacoes/js/data.js', import.meta.url), 'utf8');

  assert.doesNotMatch(data, /Falha ao carregar checklist, seguindo sem ele/);
  assert.match(data, /checklistUnavailable = true/);
  assert.match(data, /status >= 400 && status < 500/);
  assert.match(data, /showToast\(err\?\.message/);
  assert.doesNotMatch(data, /A Gestão precisa definir quem validará esta tarefa antes do envio\.'[\s\S]{0,50}return;/);
});


test('frontend mantém conclusão disponível para todos os papéis operacionais ativos', async () => {
  const [board, state] = await Promise.all([
    readFile(new URL('../painel-obrigacoes/js/ui/board.js', import.meta.url), 'utf8'),
    readFile(new URL('../painel-obrigacoes/js/state.js', import.meta.url), 'utf8'),
  ]);

  assert.match(board, /if \(active\) \{[\s\S]*?data-action="done"/);
  assert.match(state, /export function canWriteObligations\(\)[\s\S]*?'membro'[\s\S]*?'member'/);
  assert.match(state, /'gestor'[\s\S]*?'manager'[\s\S]*?'admin'[\s\S]*?'super_admin'|\['super_admin', 'admin', 'gestor', 'manager', 'membro', 'member'\]/);
});
