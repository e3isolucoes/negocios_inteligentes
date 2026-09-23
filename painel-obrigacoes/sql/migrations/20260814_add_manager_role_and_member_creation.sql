-- Separa a administração de acessos da gestão operacional e permite que
-- qualquer integrante ativo da equipe cadastre obrigações unitárias.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'gestor', 'membro'));

create or replace function public.is_manager(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((
    select role in ('admin', 'gestor') and active
    from public.profiles
    where id = uid
  ), false);
$$;

-- Um membro pode criar uma empresa pelo formulário de uma nova obrigação.
drop policy if exists "companies_insert_admin" on public.companies;
create policy "companies_insert_authenticated"
  on public.companies for insert
  to authenticated
  with check (auth.uid() is not null);

-- Todos criam; somente gestores e administradores alteram ou excluem.
drop policy if exists "obligations_insert_admin" on public.obligations;
create policy "obligations_insert_authenticated"
  on public.obligations for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "obligations_update_admin" on public.obligations;
create policy "obligations_update_management"
  on public.obligations for update
  to authenticated
  using (public.is_manager(auth.uid()))
  with check (public.is_manager(auth.uid()));

drop policy if exists "obligations_delete_admin" on public.obligations;
create policy "obligations_delete_management"
  on public.obligations for delete
  to authenticated
  using (public.is_manager(auth.uid()));

-- A leitura dos comprovantes continua deliberadamente disponível para toda a
-- equipe autenticada; recriar a policy também corrige instalações antigas.
drop policy if exists "comprovantes_select_authenticated" on storage.objects;
create policy "comprovantes_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'comprovantes');

notify pgrst, 'reload schema';
