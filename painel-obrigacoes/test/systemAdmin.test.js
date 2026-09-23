import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { STATE, isAdmin, isSuperUser } from '../js/state.js';
import { renderSystemAdmin } from '../js/ui/systemAdmin.js';
import { renderTeamManage } from '../js/ui/manageTeam.js';

test.afterEach(() => { STATE.profile = null; STATE.workspaces = []; STATE.profiles = []; });

test('superusuário mantém poderes administrativos e acesso exclusivo', () => {
  STATE.profile = { role: 'super_admin', active: true };
  assert.equal(isSuperUser(), true);
  assert.equal(isAdmin(), true);
});

test('tela apresenta empresas, modalidade e administrador do espaço', () => {
  STATE.workspaces = [{ id: 'w1', name: 'Acme Ltda', document: '00.000.000/0001-00', access_status: 'trial', trial_ends_at: '2026-08-29' }];
  STATE.profiles = [{ workspace_id: 'w1', role: 'admin', display_name: 'Maria', email: 'maria@acme.test' }];
  const html = renderSystemAdmin();
  assert.match(html, /Acme Ltda/);
  assert.match(html, /Degustação/);
  assert.match(html, /Maria/);
  assert.match(html, /Liberar completo/);
});

test('central do superusuário resume a plataforma e oferece atalhos de gestão', () => {
  STATE.workspaces = [
    { id: 'w1', name: 'Acme Ltda', access_status: 'full' },
    { id: 'w2', name: 'Beta Ltda', access_status: 'suspended' },
  ];
  STATE.profiles = [
    { workspace_id: 'w1', role: 'admin', display_name: 'Maria', active: true },
    { workspace_id: 'w1', role: 'membro', display_name: 'João', active: true },
  ];
  const html = renderSystemAdmin();
  assert.match(html, /Administração da plataforma/);
  assert.match(html, /2<\/strong><span>Empresas cadastradas/);
  assert.match(html, /Usuários e permissões/);
  assert.match(html, /Indicadores executivos/);
  assert.match(html, /1 suspensos · 1 sem admin/);
});

test('central escapa dados dos clientes antes de montar ações administrativas', () => {
  STATE.workspaces = [{ id: 'w"1', name: '<img src=x onerror=alert(1)>', access_status: 'full' }];
  const html = renderSystemAdmin();
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-id="w&quot;1"/);
});

test('superusuário define e visualiza o vínculo empresarial da equipe', () => {
  STATE.profile = { role: 'super_admin', active: true };
  STATE.workspaces = [{ id: 'w1', name: 'Acme Ltda' }, { id: 'w2', name: 'Beta Ltda' }];
  STATE.profiles = [{ id: 'u1', workspace_id: 'w2', role: 'membro', display_name: 'João', email: 'joao@beta.test' }];
  const html = renderTeamManage();
  assert.match(html, /Vínculo empresarial/);
  assert.match(html, /id="newUserWorkspace" required/);
  assert.match(html, /data-action="team-change-workspace"/);
  assert.match(html, /Empresa vinculada: <strong>Beta Ltda<\/strong>/);
  assert.match(html, /value="w2" selected/);
});

test('migração concede super admin ao Marco existente e em novos cadastros', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260815_grant_marco_super_admin.sql', import.meta.url), 'utf8');
  assert.match(sql, /lower\(new\.email\) = 'marcoantoniomiranda713@gmail\.com'/);
  assert.match(sql, /set role = 'super_admin', active = true/);
  assert.match(sql, /and auth\.uid\(\) is not null/);
});

test('migração de reparo cria o perfil ausente do superusuário', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260815_repair_marco_super_admin_profile.sql', import.meta.url), 'utf8');
  assert.match(sql, /from auth\.users/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(sql, /role = 'super_admin'/);
});

test('migração atual garante que Marco permaneça como super admin ativo', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260822_ensure_marco_super_admin.sql', import.meta.url), 'utf8');
  assert.match(sql, /from auth\.users/);
  assert.match(sql, /lower\(email\) = 'marcoantoniomiranda713@gmail\.com'/);
  assert.match(sql, /on conflict \(id\) do update/);
  assert.match(sql, /role = excluded\.role/);
  assert.match(sql, /active = excluded\.active/);
});

test('entrada da aplicação invalida módulos anteriores à tela de super admin', async () => {
  const [index, app, render] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/render.js', import.meta.url), 'utf8'),
  ]);
  const runtimeVersion = index.match(/js\/runtime-config\.js\?(v=[^\"']+)/)?.[1];
  const appVersion = index.match(/js\/app\.js\?(v=[^\"']+)/)?.[1];
  const moduleVersion = 'v=20260919-design-system-v2';

  assert.ok(runtimeVersion, 'runtime-config.js deve ter cache-busting');
  assert.ok(appVersion, 'app.js deve ter cache-busting');
  assert.equal(appVersion, runtimeVersion, 'runtime-config.js e app.js devem invalidar o cache juntos');
  assert.match(app, new RegExp(`data\\.js\\?${moduleVersion}`));
  assert.match(app, new RegExp(`render\\.js\\?${moduleVersion}`));
  assert.match(render, new RegExp(`data\\.js\\?${moduleVersion}`));
});

test('troca de papel espera a seleção efetiva em vez de reagir ao click que abre o combo', async () => {
  const render = await readFile(new URL('../js/render.js', import.meta.url), 'utf8');
  assert.match(render, /addEventListener\('change', onAppChange\)/);
  assert.match(render, /select\[data-action="team-change-role"\]/);
  assert.match(render, /action === 'team-change-role' && btn\.matches\('select'\)/);
});
