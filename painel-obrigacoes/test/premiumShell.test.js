import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shell premium remove redundância de marca/usuário e separa navegação dos filtros', async () => {
  const [renderSource, toolbarSource, css] = await Promise.all([
    readFile(new URL('../js/render.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui/toolbar.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(renderSource, /class="app-frame"/);
  assert.match(renderSource, /class="app-sidebar"/);
  assert.match(renderSource, /class="global-header"/);
  assert.match(renderSource, /class="page-heading"/);
  assert.match(renderSource, /class="account-summary"/);
  assert.equal((renderSource.match(/id="logoutBtn"/g) || []).length, 1);
  assert.match(toolbarSource, /renderSidebarNavigation/);
  assert.match(toolbarSource, /class="toolbar workspace-filters"/);
  assert.doesNotMatch(toolbarSource, /class="tabs"/);
  assert.match(css, /--app-sidebar-width/);
  assert.match(css, /\.board-brief\{[\s\S]*?display:none/);
});

test('shell premium permanece responsivo', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:1180px\)/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /@media\(max-width:540px\)/);
});
