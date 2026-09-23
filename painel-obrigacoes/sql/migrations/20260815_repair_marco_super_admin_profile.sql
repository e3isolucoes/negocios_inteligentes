-- Repara também o caso em que a conta já existia no Auth, mas ainda não
-- possuía uma linha em profiles. Sem o perfil, a aplicação assume "membro" e
-- a aba central não pode aparecer, mesmo para o proprietário.
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
    role = 'super_admin',
    active = true;

notify pgrst, 'reload schema';
