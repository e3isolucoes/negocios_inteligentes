-- Corrige instalações em que o perfil Gestor consegue abrir/editar uma
-- atividade, mas a gravação é recusada por uma policy ou alias de papel
-- anterior. Mantém o isolamento por workspace e o acesso por módulo.
begin;

create or replace function public.is_manager(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select lower(trim(role)) in ('super_admin', 'admin', 'gestor', 'manager') and active
    from public.profiles
    where id = uid
  ), false);
$$;

-- Em ambientes com módulos administrativos, Gestor é um papel de gestão
-- operacional: ele pode trabalhar em qualquer módulo do próprio workspace.
-- Membros continuam dependentes de module_access.
do $migration$
begin
  if to_regprocedure('public.can_access_module(text)') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'profiles'
         and column_name = 'module_access'
     ) then
    execute $function$
      create or replace function public.can_access_module(requested_module text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $$
        select coalesce((
          select active and (
            lower(trim(role)) in ('super_admin', 'admin', 'gestor', 'manager')
            or requested_module = any(module_access)
          )
          from public.profiles
          where id = auth.uid()
        ), false);
      $$;
    $function$;
  end if;
end
$migration$;

-- Remove nomes de policies de gerações anteriores para não deixar uma regra
-- antiga barrar o mesmo fluxo em instalações atualizadas parcialmente.
drop policy if exists "obligations_update_admin" on public.obligations;
drop policy if exists "obligations_update_management" on public.obligations;
drop policy if exists obligations_tenant_update on public.obligations;

drop policy if exists "obligations_delete_admin" on public.obligations;
drop policy if exists "obligations_delete_management" on public.obligations;
drop policy if exists obligations_tenant_delete on public.obligations;

-- Preserva a fronteira mais forte quando workspace/module já existem; em
-- instalações legadas, cai para a regra de Gestor/Admin sem abrir cross-tenant.
do $migration$
begin
  if exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'obligations'
         and column_name = 'workspace_id'
     )
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'obligations'
         and column_name = 'module_key'
     )
     and to_regprocedure('public.can_access_workspace(uuid)') is not null
     and to_regprocedure('public.can_access_module(text)') is not null then
    execute $policy$
      create policy obligations_tenant_update
        on public.obligations for update
        to authenticated
        using (
          public.can_access_workspace(workspace_id)
          and (public.is_manager(auth.uid()) or public.can_access_module(module_key))
        )
        with check (
          public.can_access_workspace(workspace_id)
          and (public.is_manager(auth.uid()) or public.can_access_module(module_key))
        )
    $policy$;

    execute $policy$
      create policy obligations_tenant_delete
        on public.obligations for delete
        to authenticated
        using (
          public.can_access_workspace(workspace_id)
          and (public.is_manager(auth.uid()) or public.can_access_module(module_key))
        )
    $policy$;
  else
    create policy obligations_update_management
      on public.obligations for update
      to authenticated
      using (public.is_manager(auth.uid()))
      with check (public.is_manager(auth.uid()));

    create policy obligations_delete_management
      on public.obligations for delete
      to authenticated
      using (public.is_manager(auth.uid()));
  end if;
end
$migration$;

commit;

notify pgrst, 'reload schema';
