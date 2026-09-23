-- Liberação granular por módulo administrativo. A categoria da atividade é a
-- chave do módulo; assim Compras nunca aparece em DP, Financeiro etc.
alter table public.profiles
  add column if not exists module_access text[] not null default '{}';

-- Preserva o acesso atual na implantação. Novos membros começam sem módulos
-- até que um administrador faça a liberação individual.
update public.profiles p
set module_access = coalesce((select array_agg(distinct c.name order by c.name) from public.categories c where coalesce(c.ativo, true)), '{}')
where cardinality(p.module_access) = 0 and p.created_at < now();

create or replace function public.can_access_module(module_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select active and (role in ('admin', 'super_admin') or module_key = any(module_access))
    from public.profiles where id = auth.uid()
  ), false);
$$;
revoke all on function public.can_access_module(text) from public;
grant execute on function public.can_access_module(text) to authenticated;

drop policy if exists obligations_tenant_select on public.obligations;
create policy obligations_tenant_select on public.obligations for select to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(category));

drop policy if exists obligations_tenant_insert on public.obligations;
create policy obligations_tenant_insert on public.obligations for insert to authenticated
with check (public.can_access_workspace(workspace_id) and public.can_access_module(category));

drop policy if exists obligations_tenant_update on public.obligations;
create policy obligations_tenant_update on public.obligations for update to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(category))
with check (public.can_access_workspace(workspace_id) and public.can_access_module(category));

drop policy if exists obligations_tenant_delete on public.obligations;
create policy obligations_tenant_delete on public.obligations for delete to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(category));
