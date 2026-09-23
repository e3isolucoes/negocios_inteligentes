-- Torna explícito o contrato das gravações operacionais do painel.
-- O front-end envia workspace_id, mas o trigger continua preenchendo-o para
-- clientes antigos e impede que qualquer papel grave no workspace de terceiros.
begin;

drop policy if exists obligations_tenant_insert on public.obligations;
create policy obligations_tenant_insert on public.obligations
  for insert to authenticated
  with check (public.can_access_workspace(workspace_id));

drop policy if exists companies_tenant_insert on public.companies;
create policy companies_tenant_insert on public.companies
  for insert to authenticated
  with check (public.can_access_workspace(workspace_id));

drop policy if exists completions_tenant_insert on public.completions;
create policy completions_tenant_insert on public.completions
  for insert to authenticated
  with check (
    public.can_access_workspace(workspace_id)
    and done_by = auth.uid()
  );

drop policy if exists comprovantes_tenant_insert on storage.objects;
create policy comprovantes_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'comprovantes'
    and public.current_workspace_id() is not null
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
  );

commit;

notify pgrst, 'reload schema';
