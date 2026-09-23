-- Prepara os dados legados para a migração ao DynamoDB.
-- Todo o acervo anterior ao isolamento multiempresa pertence à GRA Comercio.
-- A transação inteira é revertida se restar qualquer dado operacional sem tenant.
begin;

select pg_advisory_xact_lock(hashtext('e3i:backfill-legacy-workspace-for-dynamodb'));

-- A instalação atual pode ter recebido somente parte do isolamento. Garanta
-- que todas as tabelas operacionais tenham a chave de tenant antes do backfill.
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

-- As constraints NOT VALID ainda são verificadas em UPDATE. Algumas
-- conclusões históricas são anteriores à exigência de comprovante/checklist.
alter table public.completions drop constraint if exists completions_attachment_required;
alter table public.completions drop constraint if exists completions_checklist_complete;

do $$
declare
  v_gra_workspace_id uuid;
begin
  select id into v_gra_workspace_id
  from public.workspaces
  where regexp_replace(coalesce(document, ''), '\D', '', 'g') = '00999175000154'
  limit 1;

  if v_gra_workspace_id is null then
    raise exception 'Workspace GRA Comercio (00.999.175/0001-54) não encontrado.';
  end if;

  -- O superadministrador continua sem acesso operacional implícito.
  update public.profiles
  set workspace_id = v_gra_workspace_id
  where role <> 'super_admin' and workspace_id is null;

  update public.companies
  set workspace_id = v_gra_workspace_id
  where workspace_id is null;

  update public.obligations o
  set workspace_id = coalesce(c.workspace_id, v_gra_workspace_id)
  from public.companies c
  where c.id = o.company_id and o.workspace_id is null;

  update public.obligations
  set workspace_id = v_gra_workspace_id
  where workspace_id is null;

  update public.completions c
  set workspace_id = o.workspace_id
  from public.obligations o
  where o.id = c.obligation_id and c.workspace_id is null;

  update public.obligation_comments c
  set workspace_id = o.workspace_id
  from public.obligations o
  where o.id = c.obligation_id and c.workspace_id is null;

  update public.checklist_items c
  set workspace_id = o.workspace_id
  from public.obligations o
  where o.id = c.obligation_id and c.workspace_id is null;

  update public.obligation_date_overrides d
  set workspace_id = o.workspace_id
  from public.obligations o
  where o.id = d.obligation_id and d.workspace_id is null;

  update public.audit_log set workspace_id = v_gra_workspace_id where workspace_id is null;
  update public.holidays set workspace_id = v_gra_workspace_id where workspace_id is null;
  update public.obligation_rules set workspace_id = v_gra_workspace_id where workspace_id is null;
  update public.tax_regimes set workspace_id = v_gra_workspace_id where workspace_id is null;

  update public.tax_regime_rules tr
  set workspace_id = r.workspace_id
  from public.tax_regimes r
  where r.id = tr.tax_regime_id and tr.workspace_id is null;

  update public.categories set workspace_id = v_gra_workspace_id where workspace_id is null;
end
$$;

alter table public.completions add constraint completions_attachment_required
  check (attachment_path is not null) not valid;
alter table public.completions add constraint completions_checklist_complete
  check (checklist_total is null or checklist_total = 0 or checklist_checked = checklist_total) not valid;

do $$
declare
  v_missing bigint;
  v_table text;
begin
  foreach v_table in array array[
    'companies', 'obligations', 'completions', 'obligation_comments',
    'audit_log', 'holidays', 'checklist_items', 'obligation_rules',
    'obligation_date_overrides', 'tax_regimes', 'tax_regime_rules', 'categories'
  ] loop
    execute format('select count(*) from public.%I where workspace_id is null', v_table)
      into v_missing;
    if v_missing <> 0 then
      raise exception 'Backfill incompleto: %.workspace_id possui % valores nulos.',
        v_table, v_missing;
    end if;
  end loop;

  select count(*) into v_missing
  from public.profiles
  where role <> 'super_admin' and workspace_id is null;

  if v_missing <> 0 then
    raise exception 'Backfill incompleto: % perfis não super_admin continuam sem workspace.',
      v_missing;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;

-- Resultado esperado: somente o super_admin pode permanecer sem workspace.
select role, count(*) as total,
       count(*) filter (where workspace_id is null) as sem_workspace
from public.profiles
group by role
order by role;
