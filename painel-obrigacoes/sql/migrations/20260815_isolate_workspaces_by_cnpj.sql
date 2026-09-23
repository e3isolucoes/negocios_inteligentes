-- Isolamento multiempresa: todo dado operacional pertence exatamente a um
-- workspace. Os dados anteriores a esta migração pertencem ao cliente
-- GRA Comercio (CNPJ 00.999.175/0001-54); novos registros herdam o workspace
-- da sessão.
begin;

create unique index if not exists workspaces_document_digits_uidx
  on public.workspaces (regexp_replace(document, '\D', '', 'g'))
  where document is not null and regexp_replace(document, '\D', '', 'g') <> '';
alter table public.workspaces drop constraint if exists workspaces_document_cnpj_check;
alter table public.workspaces add constraint workspaces_document_cnpj_check
  check (length(regexp_replace(coalesce(document, ''), '\D', '', 'g'))=14) not valid;

insert into public.workspaces (name, document, access_status)
select 'GRA Comercio', '00.999.175/0001-54', 'full'
where not exists (
  select 1 from public.workspaces
  where regexp_replace(coalesce(document, ''), '\D', '', 'g') = '00999175000154'
);

-- Também corrige instalações nas quais o workspace já havia sido criado com
-- o nome provisório. Como todos os backfills abaixo usam o CNPJ, todo o
-- conteúdo legado fica vinculado à GRA Comercio sem depender do nome.
update public.workspaces
set name = 'GRA Comercio'
where regexp_replace(coalesce(document, ''), '\D', '', 'g') = '00999175000154';

create or replace function public.workspace_for_cnpj(p_document text) returns uuid
language sql security definer set search_path = public stable as $$
  select id from public.workspaces
  where regexp_replace(coalesce(document, ''), '\D', '', 'g') = regexp_replace(coalesce(p_document, ''), '\D', '', 'g')
  limit 1;
$$;

create or replace function public.current_workspace_id() returns uuid
language sql security definer set search_path = public stable as $$
  select workspace_id from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.can_access_workspace(p_workspace_id uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce(
    p_workspace_id = (select workspace_id from public.profiles where id = auth.uid() and active),
    false
  );
$$;

-- O superusuário administra contratos e vínculos, mas não atravessa a
-- fronteira dos dados operacionais dos clientes sem pertencer ao workspace.
update public.profiles
set workspace_id = public.workspace_for_cnpj('00.999.175/0001-54')
where role <> 'super_admin' and workspace_id is null;

-- Tabelas raiz e tabelas filhas recebem uma chave explícita de locatário.
alter table public.companies add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.obligations add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.completions add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.obligation_comments add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.audit_log add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.holidays add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.checklist_items add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.obligation_rules add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.obligation_date_overrides add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.tax_regimes add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.tax_regime_rules add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.categories add column if not exists workspace_id uuid references public.workspaces(id);

update public.companies set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;
update public.obligations set workspace_id=coalesce((select c.workspace_id from public.companies c where c.id=company_id),public.workspace_for_cnpj('00.999.175/0001-54')) where workspace_id is null;

-- As duas constraints abaixo foram criadas como NOT VALID justamente para
-- tolerar conclusões históricas sem comprovante/checklist completo. Mesmo
-- assim, o PostgreSQL as aplica quando qualquer coluna da linha é atualizada;
-- portanto, o backfill de workspace_id reprovaria essas linhas legadas. Tire
-- as travas apenas durante o backfill e recrie-as como NOT VALID antes de
-- continuar, mantendo a validação de toda gravação futura.
alter table public.completions drop constraint if exists completions_attachment_required;
alter table public.completions drop constraint if exists completions_checklist_complete;
update public.completions c set workspace_id=o.workspace_id from public.obligations o where c.obligation_id=o.id and c.workspace_id is null;
alter table public.completions add constraint completions_attachment_required
  check (attachment_path is not null) not valid;
alter table public.completions add constraint completions_checklist_complete
  check (checklist_total is null or checklist_total = 0 or checklist_checked = checklist_total) not valid;
update public.obligation_comments c set workspace_id=o.workspace_id from public.obligations o where c.obligation_id=o.id and c.workspace_id is null;
update public.checklist_items c set workspace_id=o.workspace_id from public.obligations o where c.obligation_id=o.id and c.workspace_id is null;
update public.obligation_date_overrides d set workspace_id=o.workspace_id from public.obligations o where d.obligation_id=o.id and d.workspace_id is null;
update public.audit_log set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;
update public.holidays set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;
update public.obligation_rules set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;
update public.tax_regimes set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;
update public.tax_regime_rules tr set workspace_id=r.workspace_id from public.tax_regimes r where tr.tax_regime_id=r.id and tr.workspace_id is null;
update public.categories set workspace_id=public.workspace_for_cnpj('00.999.175/0001-54') where workspace_id is null;

alter table public.companies alter column workspace_id set not null;
alter table public.obligations alter column workspace_id set not null;
alter table public.completions alter column workspace_id set not null;
alter table public.obligation_comments alter column workspace_id set not null;
alter table public.audit_log alter column workspace_id set not null;
alter table public.holidays alter column workspace_id set not null;
alter table public.checklist_items alter column workspace_id set not null;
alter table public.obligation_rules alter column workspace_id set not null;
alter table public.obligation_date_overrides alter column workspace_id set not null;
alter table public.tax_regimes alter column workspace_id set not null;
alter table public.tax_regime_rules alter column workspace_id set not null;
alter table public.categories alter column workspace_id set not null;

create index if not exists companies_workspace_idx on public.companies(workspace_id);
create index if not exists obligations_workspace_idx on public.obligations(workspace_id);
create index if not exists completions_workspace_idx on public.completions(workspace_id);
create index if not exists profiles_workspace_idx on public.profiles(workspace_id);

-- Unicidades antes globais passam a valer dentro de cada empresa.
alter table public.companies drop constraint if exists companies_name_key;
alter table public.holidays drop constraint if exists holidays_holiday_date_key;
alter table public.obligation_rules drop constraint if exists obligation_rules_name_key;
alter table public.tax_regimes drop constraint if exists tax_regimes_name_key;
alter table public.obligations drop constraint if exists obligations_category_fkey;
alter table public.obligation_rules drop constraint if exists obligation_rules_category_fkey;
alter table public.categories drop constraint if exists categories_name_key;
create unique index if not exists companies_workspace_name_uidx on public.companies(workspace_id, lower(name));
create unique index if not exists holidays_workspace_date_uidx on public.holidays(workspace_id, holiday_date);
create unique index if not exists obligation_rules_workspace_name_uidx on public.obligation_rules(workspace_id, lower(name));
create unique index if not exists tax_regimes_workspace_name_uidx on public.tax_regimes(workspace_id, lower(name));
create unique index if not exists categories_workspace_name_uidx on public.categories(workspace_id, name);
create unique index if not exists companies_id_workspace_uidx on public.companies(id, workspace_id);
create unique index if not exists profiles_id_workspace_uidx on public.profiles(id, workspace_id);
create unique index if not exists tax_regimes_id_workspace_uidx on public.tax_regimes(id, workspace_id);
alter table public.obligations drop constraint if exists obligations_company_workspace_fkey;
alter table public.obligations add constraint obligations_company_workspace_fkey foreign key(company_id,workspace_id) references public.companies(id,workspace_id);
alter table public.obligations drop constraint if exists obligations_responsible_workspace_fkey;
alter table public.obligations add constraint obligations_responsible_workspace_fkey foreign key(responsible_id,workspace_id) references public.profiles(id,workspace_id);
alter table public.obligations add constraint obligations_category_workspace_fkey foreign key(workspace_id,category) references public.categories(workspace_id,name) on update cascade;
alter table public.obligation_rules add constraint obligation_rules_category_workspace_fkey foreign key(workspace_id,category) references public.categories(workspace_id,name) on update cascade;
alter table public.companies drop constraint if exists companies_tax_regime_workspace_fkey;
alter table public.companies add constraint companies_tax_regime_workspace_fkey foreign key(tax_regime_id,workspace_id) references public.tax_regimes(id,workspace_id);

create or replace function public.assign_and_validate_workspace() returns trigger
language plpgsql security definer set search_path=public as $$
declare expected uuid;
begin
  expected := public.current_workspace_id();
  if expected is null then raise exception 'Usuário sem espaço de empresa vinculado.' using errcode='42501'; end if;
  if new.workspace_id is null then new.workspace_id := expected; end if;
  if new.workspace_id <> expected then raise exception 'Não é permitido gravar dados em outra empresa.' using errcode='42501'; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['companies','obligations','completions','obligation_comments','holidays','checklist_items','obligation_rules','obligation_date_overrides','tax_regimes','tax_regime_rules','categories'] loop
    execute format('drop trigger if exists trg_workspace_guard on public.%I',t);
    execute format('create trigger trg_workspace_guard before insert or update of workspace_id on public.%I for each row execute function public.assign_and_validate_workspace()',t);
  end loop;
end $$;

-- Filhos nunca podem apontar para um registro de outro workspace, mesmo que
-- alguém descubra/forje o UUID pela API.
create or replace function public.validate_workspace_relations() returns trigger
language plpgsql security definer set search_path=public as $$
declare related uuid;
begin
  if tg_table_name in ('completions','obligation_comments','checklist_items','obligation_date_overrides') then
    execute 'select workspace_id from public.obligations where id=$1' into related using new.obligation_id;
  elsif tg_table_name='tax_regime_rules' then
    select workspace_id into related from public.tax_regimes where id=new.tax_regime_id;
    if related is distinct from new.workspace_id or not exists(select 1 from public.obligation_rules where id=new.obligation_rule_id and workspace_id=new.workspace_id) then
      raise exception 'Vínculo entre empresas diferentes.' using errcode='23514';
    end if;
    return new;
  end if;
  if related is distinct from new.workspace_id then raise exception 'Vínculo entre empresas diferentes.' using errcode='23514'; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['completions','obligation_comments','checklist_items','obligation_date_overrides','tax_regime_rules'] loop
    execute format('drop trigger if exists trg_workspace_relation on public.%I',t);
    execute format('create trigger trg_workspace_relation before insert or update on public.%I for each row execute function public.validate_workspace_relations()',t);
  end loop;
end $$;

-- Perfis só são visíveis/editáveis dentro da própria empresa; o
-- superusuário mantém a visão central necessária para vincular usuários.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy profiles_select_workspace on public.profiles for select to authenticated
using (public.is_super_admin(auth.uid()) or workspace_id=public.current_workspace_id() or id=auth.uid());
drop policy if exists "profiles_update_admin_or_self" on public.profiles;
create policy profiles_update_workspace on public.profiles for update to authenticated
using (public.is_super_admin(auth.uid()) or id=auth.uid() or (public.is_admin(auth.uid()) and (workspace_id=public.current_workspace_id() or workspace_id is null)))
with check (public.is_super_admin(auth.uid()) or id=auth.uid() or (public.is_admin(auth.uid()) and workspace_id=public.current_workspace_id()));

create or replace function public.protect_profile_workspace() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.workspace_id is not distinct from old.workspace_id then return new; end if;
  if public.is_super_admin(auth.uid()) then return new; end if;
  if public.is_admin(auth.uid()) and old.workspace_id is null and new.workspace_id=public.current_workspace_id() then return new; end if;
  raise exception 'Somente o superusuário pode transferir uma conta entre empresas.' using errcode='42501';
end $$;
drop trigger if exists trg_protect_profile_workspace on public.profiles;
create trigger trg_protect_profile_workspace before update of workspace_id on public.profiles
for each row execute function public.protect_profile_workspace();

-- Substitui toda policy operacional antiga por políticas uniformes de
-- locatário. As regras de papel continuam diferenciando leitura/escrita.
do $$ declare t text; p record; begin
  foreach t in array array['companies','obligations','completions','obligation_comments','audit_log','holidays','checklist_items','obligation_rules','obligation_date_overrides','tax_regimes','tax_regime_rules','categories'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['companies','obligations','completions','obligation_comments','holidays','checklist_items','obligation_rules','obligation_date_overrides','tax_regimes','tax_regime_rules','categories'] loop
    execute format('create policy tenant_select on public.%I for select to authenticated using (public.can_access_workspace(workspace_id))',t);
  end loop;
end $$;
create policy audit_tenant_select on public.audit_log for select to authenticated
using (public.can_access_workspace(workspace_id) and public.is_admin(auth.uid()));

create policy companies_tenant_write on public.companies for all to authenticated
using (public.can_access_workspace(workspace_id) and public.is_admin(auth.uid())) with check (public.can_access_workspace(workspace_id) and public.is_admin(auth.uid()));
create policy obligations_tenant_insert on public.obligations for insert to authenticated with check (public.can_access_workspace(workspace_id));
create policy obligations_tenant_change on public.obligations for update to authenticated
using (public.can_access_workspace(workspace_id) and public.is_manager(auth.uid())) with check (public.can_access_workspace(workspace_id) and public.is_manager(auth.uid()));
create policy obligations_tenant_delete on public.obligations for delete to authenticated using (public.can_access_workspace(workspace_id) and public.is_manager(auth.uid()));
create policy completions_tenant_insert on public.completions for insert to authenticated with check (public.can_access_workspace(workspace_id) and done_by=auth.uid());
create policy completions_tenant_update on public.completions for update to authenticated
using (public.can_access_workspace(workspace_id) and (validator_id=auth.uid() or (done_by=auth.uid() and status='rejeitada')))
with check (public.can_access_workspace(workspace_id) and (validator_id=auth.uid() or done_by=auth.uid()));
create policy completions_tenant_delete on public.completions for delete to authenticated
using (public.can_access_workspace(workspace_id) and (done_by=auth.uid() or public.is_admin(auth.uid())));
create policy comments_tenant_insert on public.obligation_comments for insert to authenticated with check (public.can_access_workspace(workspace_id) and author_id=auth.uid());
create policy comments_tenant_delete on public.obligation_comments for delete to authenticated
using (public.can_access_workspace(workspace_id) and (author_id=auth.uid() or public.is_admin(auth.uid())));

do $$ declare t text; begin
  foreach t in array array['holidays','checklist_items','obligation_rules','obligation_date_overrides','tax_regimes','tax_regime_rules','categories'] loop
    execute format('create policy tenant_admin_write on public.%I for all to authenticated using (public.can_access_workspace(workspace_id) and public.is_admin(auth.uid())) with check (public.can_access_workspace(workspace_id) and public.is_admin(auth.uid()))',t);
  end loop;
end $$;

-- O caminho novo começa pelo workspace. Arquivos antigos continuam sendo
-- autorizados pela conclusão à qual o nome completo está associado.
drop policy if exists "comprovantes_select_authenticated" on storage.objects;
drop policy if exists "comprovantes_insert_authenticated" on storage.objects;
drop policy if exists "comprovantes_delete_own_or_admin" on storage.objects;
create policy comprovantes_tenant_select on storage.objects for select to authenticated using (
  bucket_id='comprovantes' and exists(select 1 from public.completions c where c.attachment_path=name and public.can_access_workspace(c.workspace_id))
);
create policy comprovantes_tenant_insert on storage.objects for insert to authenticated with check (
  bucket_id='comprovantes' and (storage.foldername(name))[1]=public.current_workspace_id()::text
);
create policy comprovantes_tenant_delete on storage.objects for delete to authenticated using (
  bucket_id='comprovantes' and exists(select 1 from public.completions c where c.attachment_path=name and public.can_access_workspace(c.workspace_id))
  and (owner=auth.uid() or public.is_admin(auth.uid()))
);

-- O log recebe o workspace da própria obrigação, não da entrada do cliente.
create or replace function public.log_obligation_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare source_row record; v_diff jsonb;
begin
  if tg_op='DELETE' then source_row:=old; v_diff:=to_jsonb(old);
  elsif tg_op='UPDATE' then source_row:=new; v_diff:=jsonb_build_object('antes',to_jsonb(old),'depois',to_jsonb(new));
  else source_row:=new; v_diff:=to_jsonb(new); end if;
  insert into public.audit_log(table_name,row_id,action,changed_by,changed_by_name,diff,workspace_id)
  values('obligations',source_row.id,lower(tg_op),auth.uid(),coalesce((select display_name from public.profiles where id=auth.uid()),'sistema'),v_diff,source_row.workspace_id);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

notify pgrst, 'reload schema';
commit;
