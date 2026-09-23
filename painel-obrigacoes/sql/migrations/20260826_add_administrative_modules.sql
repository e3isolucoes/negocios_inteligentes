-- Módulos representam áreas da empresa e NÃO categorias tributárias.
create table if not exists public.administrative_modules (
  key text primary key,
  name text not null,
  color text not null,
  sort_order integer not null default 100,
  active boolean not null default true
);

insert into public.administrative_modules (key, name, color, sort_order) values
  ('fiscal', 'Fiscal', '#2563eb', 10),
  ('contabil', 'Contábil', '#0891b2', 20),
  ('departamento_pessoal', 'Departamento Pessoal', '#ca8a04', 30),
  ('recursos_humanos', 'Recursos Humanos', '#be185d', 40),
  ('financeiro', 'Financeiro', '#047857', 50),
  ('compras', 'Compras', '#7c3aed', 60),
  ('vendas', 'Vendas', '#c2410c', 70),
  ('administrativo', 'Administrativo', '#475569', 80)
on conflict (key) do update set name=excluded.name, color=excluded.color, sort_order=excluded.sort_order;

alter table public.obligations
  add column if not exists module_key text not null default 'fiscal'
  references public.administrative_modules(key);

-- O campo legado area_name não é utilizado como módulo. Atividades já
-- existentes permanecem no Fiscal até serem reclassificadas conscientemente.
create index if not exists obligations_workspace_module_idx
  on public.obligations(workspace_id, module_key);

alter table public.profiles
  add column if not exists module_access text[] not null default '{}';

update public.profiles
set module_access = array(select key from public.administrative_modules where active order by sort_order)
where cardinality(module_access) = 0;

create or replace function public.can_access_module(requested_module text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select active and (
    role in ('admin', 'super_admin') or requested_module = any(module_access)
  ) from public.profiles where id=auth.uid()), false);
$$;
revoke all on function public.can_access_module(text) from public;
grant execute on function public.can_access_module(text) to authenticated;

drop policy if exists obligations_tenant_select on public.obligations;
create policy obligations_tenant_select on public.obligations for select to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(module_key));
drop policy if exists obligations_tenant_insert on public.obligations;
create policy obligations_tenant_insert on public.obligations for insert to authenticated
with check (public.can_access_workspace(workspace_id) and public.can_access_module(module_key));
drop policy if exists obligations_tenant_update on public.obligations;
create policy obligations_tenant_update on public.obligations for update to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(module_key))
with check (public.can_access_workspace(workspace_id) and public.can_access_module(module_key));
drop policy if exists obligations_tenant_delete on public.obligations;
create policy obligations_tenant_delete on public.obligations for delete to authenticated
using (public.can_access_workspace(workspace_id) and public.can_access_module(module_key));

grant select on public.administrative_modules to authenticated;
notify pgrst, 'reload schema';
