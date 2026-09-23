import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const uiFiles = [
  '../js/render.js',
  '../js/ui/board.js',
  '../js/ui/manageTeam.js',
  '../js/ui/dashboard.js',
  '../js/ui/reports.js',
  '../js/ui/modal.js',
];

test('design system centraliza tipografia, superfícies e controles', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');

  for (const token of [
    '--ds-font-ui',
    '--ds-font-display',
    '--ds-bg',
    '--ds-surface',
    '--ds-border',
    '--ds-text',
    '--ds-radius-md',
    '--ds-shadow-sm',
    '--ds-control-h',
  ]) {
    assert.ok(css.includes(token), 'token visual ausente: ' + token);
  }

  assert.match(css, /E3I DESIGN SYSTEM — UNIFIED UI 2026-09/);
  assert.match(css, /\.btn-primary[\s\S]*?var\(--ds-navy-900\)/);
  assert.match(css, /\.field input,[\s\S]*?var\(--ds-border\)/);
  assert.match(css, /\.modal,[\s\S]*?var\(--ds-radius-xl\)/);
  assert.match(css, /\.card,[\s\S]*?\.report-section,[\s\S]*?\.dashboard-section/);
  assert.doesNotMatch(css, /'Space Grotesk'/);
  assert.doesNotMatch(css, /'Inter'/);
});

test('views não reintroduzem estilos inline estáticos fora de valores dinâmicos', async () => {
  const allowed = [
    /style="width:/,
    /style="--score:/,
    /style="--area-color:/,
    /style="--badge-color:/,
  ];

  for (const relative of uiFiles) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    for (const line of source.split('\n').filter((item) => item.includes('style='))) {
      assert.ok(
        allowed.some((pattern) => pattern.test(line)),
        relative + ' contém estilo inline estático fora do design system: ' + line.trim(),
      );
    }
  }
});

test('componentes principais compartilham o mesmo vocabulário visual', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');

  for (const selector of [
    '.btn-primary',
    '.btn-secondary',
    '.btn-ghost',
    '.btn-sm',
    '.badge',
    '.status-pill',
    '.field input',
    '.dd-panel',
    '.mgmt-row',
    '.report-section',
    '.dashboard-section',
    '.system-company-card',
    '.modal',
    '.login-layout',
    '.empty',
  ]) {
    assert.ok(css.includes(selector), 'componente visual ausente: ' + selector);
  }
});
