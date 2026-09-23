-- Garante que a conta proprietária existente no Supabase Auth tenha um perfil
-- ativo com acesso à administração central. A migração é idempotente para
-- poder ser reaplicada com segurança.
insert into public.profiles (id, email, display_name, role, active)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(email, '@', 1)),
  'super_admin',
  true
from auth.users
where lower(email) = 'marcoantoniomiranda713@gmail.com'
on conflict (id) do update
set email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
    role = excluded.role,
    active = excluded.active;

notify pgrst, 'reload schema';
