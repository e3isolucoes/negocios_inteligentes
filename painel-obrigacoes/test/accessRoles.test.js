import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STATE, isAdmin, isManager, hasAdministrationAccess, canWriteObligations, canViewAllObligations,
} from '../js/state.js';
import { renderBoard } from '../js/ui/board.js';
import { renderToolbar, renderSidebarNavigation } from '../js/ui/toolbar.js';
import { validatorFieldHtml } from '../js/ui/validatorField.js';

test.afterEach(() => {
  STATE.profile = null;
  STATE.session = null;
  STATE.obligations = [];
  STATE.companies = [];
  STATE.validation = { pending: 0, rejected: 0 };
});

test('gestor tem acesso operacional, mas Administração exige concessão explícita', () => {
  STATE.profile = { role: 'gestor', active: true };
  assert.equal(isManager(), true);
  assert.equal(isAdmin(), false);
  assert.equal(hasAdministrationAccess(), false);
  assert.equal(canViewAllObligations(), true);
  assert.doesNotMatch(renderSidebarNavigation(), /data-tab="manage"/);
  assert.doesNotMatch(renderSidebarNavigation(), /data-tab="mine"/);

  STATE.profile = { role: 'manager', active: true, module_grants: ['administracao'] };
  assert.equal(isManager(), true);
  assert.equal(hasAdministrationAccess(), true);
  assert.match(renderSidebarNavigation(), /data-tab="manage"/);

  STATE.profile = { role: 'admin', active: true, module_grants: [] };
  assert.equal(isAdmin(), true);
  assert.equal(hasAdministrationAccess(), true);
  assert.match(renderSidebarNavigation(), /data-tab="manage"/);
});

test('membro delegado recebe Administração sem virar Admin da Ferramenta', () => {
  STATE.profile = { role: 'membro', active: true, module_access: ['fiscal', 'administracao'] };
  assert.equal(isAdmin(), false);
  assert.equal(hasAdministrationAccess(), true);
  assert.match(renderSidebarNavigation(), /Administração/);

  STATE.profile = { role: 'membro', active: true, module_access: ['fiscal'] };
  assert.equal(hasAdministrationAccess(), false);
  assert.doesNotMatch(renderSidebarNavigation(), /Administração/);
});

test('validação de atividade é opt-in e não bloqueia registro legado', () => {
  const legacyMemberHtml = validatorFieldHtml({ id: 'ob-legada' }, [], false);
  assert.match(legacyMemberHtml, /id="fRequiresValidation"/);
  assert.doesNotMatch(legacyMemberHtml, /id="fRequiresValidation"[^>]*checked/);

  const managerHtml = validatorFieldHtml({ id: 'ob-nova', requires_validation: false }, [], true);
  assert.match(managerHtml, /id="fRequiresValidation"/);
  assert.doesNotMatch(managerHtml, /id="fRequiresValidation"[^>]*disabled/);
});

test('gestor visualiza toda a carteira mesmo ao chegar pelo antigo recorte pessoal', () => {
  STATE.profile = { role: 'gestor', active: true };
  STATE.session = { id: 'gestor-1' };
  STATE.obligations = [
    {
      id: 'de-outro-responsavel', name: 'Obrigação de toda a equipe', category: 'federal',
      frequency: 'pontual', due_date: '2099-12-31', responsible: 'Maria',
      responsible_id: 'membro-2', company_id: null, business_day_shift: 'nenhum',
    },
  ];

  const html = renderBoard({ onlyMine: true });

  assert.match(html, /Obrigação de toda a equipe/);
  assert.match(html, /GESTÃO À VISTA · AGORA/);
});

test('membro ativo pode incluir, editar e excluir atividades/obrigações', async () => {
  STATE.profile = { role: 'membro', active: true };
  STATE.session = { id: 'membro-1' };
  STATE.obligations = [{
    id: 'ob-1', name: 'Obrigação editável', category: 'federal', frequency: 'pontual',
    due_date: '2099-12-31', responsible: 'Membro', responsible_id: 'membro-1',
    company_id: null, business_day_shift: 'nenhum',
  }];

  assert.equal(isManager(), false);
  assert.equal(canWriteObligations(), true);
  assert.equal(canViewAllObligations(), false);
  assert.match(renderToolbar(), /data-action="new"/);
  assert.match(renderBoard({ onlyMine: true }), /data-action="edit" data-id="ob-1"/);
  assert.doesNotMatch(renderSidebarNavigation(), /data-tab="manage"/);

  const [renderSource, modalSource, validatorSource, modelSource, dataSource, checklistSource, contractSource] = await Promise.all([
    readFile(new URL('../js/render.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui/modal.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui/validatorField.js', import.meta.url), 'utf8'),
    readFile(new URL('../aws/api/src/model.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../js/data.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/api/checklist.js', import.meta.url), 'utf8'),
    readFile(new URL('../aws/api/src/contract.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(renderSource, /action === 'edit'[\s\S]*?canWriteObligations\(\)/);
  assert.match(renderSource, /action === 'delete'[\s\S]*?canWriteObligations\(\)/);
  assert.match(modalSource, /data-action="delete-in-modal"/);
  assert.match(validatorSource, /fRequiresValidation[\s\S]*?fValidator[\s\S]*?hidden/);
  assert.match(modelSource, /obligations:[\s\S]*?write: \['member', 'manager', 'admin', 'super_admin'\]/);
  assert.match(modelSource, /companies:[\s\S]*?create: \['member', 'manager', 'admin', 'super_admin'\]/);
  assert.match(modalSource, /requires_validation: false/);
  assert.match(modalSource, /requires_validation: ob\.requires_validation === true/);
  assert.match(validatorSource, /requires_validation === true/);
  assert.doesNotMatch(validatorSource, /requires_validation !== false/);
  assert.match(dataSource, /requires_validation: formData\.requires_validation === true/);
  assert.match(checklistSource, /completed: done/);
  assert.match(contractSource, /entityType === 'checklist_items'[\s\S]*?completed: record\.done/);
});

test('módulos administrativos não reutilizam categorias de obrigação acessória', async () => {
  const [constants, migration, modal] = await Promise.all([
    readFile(new URL('../js/constants.js', import.meta.url), 'utf8'),
    readFile(new URL('../sql/migrations/20260826_add_administrative_modules.sql', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui/modal.js', import.meta.url), 'utf8'),
  ]);
  assert.match(constants, /ADMINISTRATIVE_MODULES/);
  assert.match(constants, /departamento_pessoal/);
  assert.match(migration, /module_key text not null/);
  assert.match(migration, /can_access_module\(module_key\)/);
  assert.match(modal, /Categoria da obrigação acessória/);
  assert.match(modal, /activityTypeSel\.value !== 'obrigacao_acessoria'/);
});

test('hotfix garante que gestor salve alterações de atividade sem perder isolamento', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260918_allow_manager_activity_updates.sql', import.meta.url), 'utf8');

  assert.match(sql, /create or replace function public\.is_manager/);
  assert.match(sql, /'gestor', 'manager'/);
  assert.match(sql, /create policy obligations_tenant_update/);
  assert.match(sql, /public\.can_access_workspace\(workspace_id\)/);
  assert.match(sql, /public\.is_manager\(auth\.uid\(\)\)/);
  assert.match(sql, /public\.can_access_module\(module_key\)/);
  assert.doesNotMatch(sql, /using \(public\.is_admin\(auth\.uid\(\)\)\)/);
});

test('migração cria gestor, libera criação e mantém comprovantes visíveis à equipe', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260814_add_manager_role_and_member_creation.sql', import.meta.url), 'utf8');
  assert.match(sql, /role in \('admin', 'gestor', 'membro'\)/);
  assert.match(sql, /obligations_insert_authenticated/);
  assert.match(sql, /with check \(auth\.uid\(\) is not null\)/);
  assert.match(sql, /comprovantes_select_authenticated[\s\S]*?to authenticated/);
});

test('isolamento permite a todos os papéis cadastrar obrigações e comprovantes no próprio workspace', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260818_allow_all_roles_create_obligations_and_receipts.sql', import.meta.url), 'utf8');

  assert.match(sql, /obligations_tenant_insert[\s\S]*?to authenticated[\s\S]*?can_access_workspace\(workspace_id\)/);
  assert.match(sql, /companies_tenant_insert[\s\S]*?to authenticated[\s\S]*?can_access_workspace\(workspace_id\)/);
  assert.match(sql, /comprovantes_tenant_insert[\s\S]*?to authenticated/);
  assert.match(sql, /storage\.foldername\(name\)[\s\S]*?current_workspace_id\(\)/);
  assert.doesNotMatch(sql, /is_(?:admin|manager)\(auth\.uid\(\)\)/);
});

test('migração de permissões também funciona antes da criação de workspace_id', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260818_allow_all_roles_create_obligations_and_receipts.sql', import.meta.url), 'utf8');

  assert.match(sql, /information_schema\.columns[\s\S]*?table_name = 'obligations'[\s\S]*?column_name = 'workspace_id'/);
  assert.match(sql, /information_schema\.columns[\s\S]*?table_name = 'companies'[\s\S]*?column_name = 'workspace_id'/);
  assert.match(sql, /to_regprocedure\('public\.can_access_workspace\(uuid\)'\)/);
  assert.match(sql, /to_regprocedure\('public\.current_workspace_id\(\)'\)/);
  assert.match(sql, /with check \(auth\.uid\(\) is not null\)/);
});

test('erro de cadastro explica o vínculo ao workspace sem restringir membros à administração', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');

  assert.match(data, /perfil precisa estar ativo e vinculado ao espaço da empresa/);
  assert.doesNotMatch(data, /Somente um perfil administrador ativo pode cadastrar obrigações/);
});

test('cadastro recupera vínculo empresarial alterado enquanto a aba estava aberta', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');

  assert.match(data, /err\.code !== '42501'/);
  assert.match(data, /fetchMyProfile\(STATE\.session\.id\)/);
  assert.match(data, /refreshedProfile\.workspace_id === previousWorkspaceId/);
  assert.match(data, /saved = await save\(\)/);
});

test('gravações operacionais enviam explicitamente o workspace do perfil', async () => {
  const [context, obligations, companies, completions] = await Promise.all([
    readFile(new URL('../js/api/workspaceContext.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/api/obligations.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/api/companies.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/api/completions.js', import.meta.url), 'utf8'),
  ]);

  assert.match(context, /STATE\.profile\?\.workspace_id/);
  assert.match(context, /workspace_id/);
  assert.match(context, /não está vinculada a um espaço de empresa/);
  for (const source of [obligations, companies, completions]) {
    assert.match(source, /withCurrentWorkspace/);
  }
});

test('histórico de atividade congela competência e estrutura concluída', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260918_freeze_activity_history.sql', import.meta.url), 'utf8');

  assert.match(sql, /add column if not exists competence_date date/);
  assert.match(sql, /add column if not exists obligation_snapshot jsonb/);
  assert.match(sql, /add column if not exists structure_history jsonb/);
  assert.match(sql, /update public\.completions c[\s\S]*?completion_competence_date/);
  assert.match(sql, /trg_freeze_completion_history_insert/);
  assert.match(sql, /trg_preserve_obligation_structure_history/);
  assert.match(sql, /new\.competence_date := old\.competence_date/);
  assert.match(sql, /new\.obligation_snapshot := old\.obligation_snapshot/);
});

test('migração endurecida mantém criação e conclusão restritas ao workspace ativo', async () => {
  const sql = await readFile(new URL('../sql/migrations/20260818_harden_workspace_writes.sql', import.meta.url), 'utf8');
  assert.match(sql, /obligations_tenant_insert[\s\S]*can_access_workspace\(workspace_id\)/);
  assert.match(sql, /companies_tenant_insert[\s\S]*can_access_workspace\(workspace_id\)/);
  assert.match(sql, /completions_tenant_insert[\s\S]*done_by = auth\.uid\(\)/);
  assert.match(sql, /comprovantes_tenant_insert[\s\S]*storage\.foldername\(name\)/);
});
