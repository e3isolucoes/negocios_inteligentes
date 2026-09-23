-- Administração central e isolamento lógico dos clientes.
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 1),
  document text,
  access_status text not null default 'trial' check (access_status in ('trial', 'full', 'suspended')),
  trial_ends_at date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.profiles add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('super_admin', 'admin', 'gestor', 'membro'));

create or replace function public.is_super_admin(uid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select role = 'super_admin' and active from public.profiles where id = uid), false);
$$;

create or replace function public.is_admin(uid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select role in ('super_admin', 'admin') and active from public.profiles where id = uid), false);
$$;

create or replace function public.is_manager(uid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select role in ('super_admin', 'admin', 'gestor') and active from public.profiles where id = uid), false);
$$;

alter table public.workspaces enable row level security;
drop policy if exists workspaces_super_admin_all on public.workspaces;
create policy workspaces_super_admin_all on public.workspaces for all to authenticated
using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
drop policy if exists workspaces_member_read on public.workspaces;
create policy workspaces_member_read on public.workspaces for select to authenticated
using (id = (select workspace_id from public.profiles where id = auth.uid()));

create index if not exists profiles_workspace_idx on public.profiles(workspace_id);

create or replace function public.protect_super_admin_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role = 'super_admin' or old.role = 'super_admin') and not public.is_super_admin(auth.uid()) then
    raise exception 'Somente o superusuário pode conceder ou alterar este papel.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_super_admin_role on public.profiles;
create trigger trg_protect_super_admin_role before update on public.profiles
for each row execute function public.protect_super_admin_role();

-- Execute uma única vez para promover a conta proprietária:
-- update public.profiles set role = 'super_admin' where email = 'proprietario@exemplo.com';
