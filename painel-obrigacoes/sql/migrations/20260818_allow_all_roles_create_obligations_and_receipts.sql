-- Restaura as permissões operacionais depois do isolamento por workspace.
-- O papel controla administração/edição, não o trabalho diário: qualquer
-- integrante ativo e vinculado ao workspace pode cadastrar obrigações e
-- enviar os respectivos comprovantes.
begin;

drop policy if exists obligations_tenant_insert on public.obligations;
do $migration$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'obligations'
      and column_name = 'workspace_id'
  ) and to_regprocedure('public.can_access_workspace(uuid)') is not null then
    execute $policy$
      create policy obligations_tenant_insert
        on public.obligations for insert
        to authenticated
        with check (public.can_access_workspace(workspace_id))
    $policy$;
  else
    create policy obligations_tenant_insert
      on public.obligations for insert
      to authenticated
      with check (auth.uid() is not null);
  end if;
end
$migration$;

-- O formulário de obrigação aceita cadastrar uma empresa ainda inexistente.
-- Sem esta policy, membros falham antes mesmo do INSERT da obrigação.
drop policy if exists companies_tenant_insert on public.companies;
do $migration$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'companies'
      and column_name = 'workspace_id'
  ) and to_regprocedure('public.can_access_workspace(uuid)') is not null then
    execute $policy$
      create policy companies_tenant_insert
        on public.companies for insert
        to authenticated
        with check (public.can_access_workspace(workspace_id))
    $policy$;
  else
    create policy companies_tenant_insert
      on public.companies for insert
      to authenticated
      with check (auth.uid() is not null);
  end if;
end
$migration$;

drop policy if exists comprovantes_tenant_insert on storage.objects;
do $migration$
begin
  if to_regprocedure('public.current_workspace_id()') is not null then
    execute $policy$
      create policy comprovantes_tenant_insert
        on storage.objects for insert
        to authenticated
        with check (
          bucket_id = 'comprovantes'
          and public.current_workspace_id() is not null
          and (storage.foldername(name))[1] = public.current_workspace_id()::text
        )
    $policy$;
  else
    create policy comprovantes_tenant_insert
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'comprovantes'
        and auth.uid() is not null
      );
  end if;
end
$migration$;

commit;

notify pgrst, 'reload schema';
