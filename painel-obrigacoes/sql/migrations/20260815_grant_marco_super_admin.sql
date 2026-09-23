-- Concede a administração central à conta proprietária e mantém o bootstrap
-- funcionando caso o perfil só seja criado depois da execução da migração.
create or replace function public.protect_super_admin_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role = 'super_admin' or old.role = 'super_admin')
     and auth.uid() is not null
     and not public.is_super_admin(auth.uid()) then
    raise exception 'Somente o superusuário pode conceder ou alterar este papel.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    case
      when lower(new.email) = 'marcoantoniomiranda713@gmail.com' then 'super_admin'
      else 'membro'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles
set role = 'super_admin', active = true
where lower(email) = 'marcoantoniomiranda713@gmail.com';

notify pgrst, 'reload schema';
