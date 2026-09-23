-- Hotfix idempotente para instalações que publicaram o importador novo sem
-- reaplicar sql/schema.sql. Não remove nem modifica obrigações existentes.

alter table public.obligations enable row level security;
alter table public.obligations no force row level security;

-- O front-end aceita obrigações diárias sem campos de vencimento. Bancos
-- criados antes dessa frequência ainda possuem o CHECK antigo, que exige dia,
-- mês ou data e faz a RPC falhar com o código 23514. Recriar os dois CHECKs
-- aqui mantém este hotfix autocontido para instalações já existentes.
alter table public.obligations drop constraint if exists obligations_frequency_check;
alter table public.obligations add constraint obligations_frequency_check
  check (frequency in ('diaria', 'mensal', 'trimestral', 'anual', 'pontual'));

alter table public.obligations drop constraint if exists frequency_fields_check;
alter table public.obligations add constraint frequency_fields_check check (
  (frequency = 'diaria') or
  (frequency = 'mensal' and day_of_month is not null) or
  (frequency = 'trimestral' and day_of_month is not null and months is not null) or
  (frequency = 'anual' and day_of_month is not null and month is not null) or
  (frequency = 'pontual' and due_date is not null)
);

drop policy if exists "obligations_insert_admin" on public.obligations;
create policy "obligations_insert_admin"
  on public.obligations for insert
  to authenticated
  with check (public.is_admin(auth.uid()));

create or replace function public.import_obligations(p_items jsonb)
returns setof public.obligations
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sessão expirada ou usuário não autenticado.';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception using errcode = '42501', message = 'Somente administradores podem importar obrigações.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'A importação deve ser uma lista de obrigações.';
  end if;
  if jsonb_array_length(p_items) = 0 then return; end if;
  if jsonb_array_length(p_items) > 2000 then
    raise exception using errcode = '54000', message = 'A planilha excede o limite de 2.000 obrigações por importação.';
  end if;

  return query
    insert into public.obligations (
      name, category, company_id, responsible, responsible_id, frequency,
      day_type, day_of_month, month, months, due_date, notes, priority,
      business_day_shift, requires_validation, validator_id, created_by
    )
    select
      nullif(btrim(item->>'name'), ''), item->>'category',
      nullif(item->>'company_id', '')::uuid,
      coalesce(item->>'responsible', ''),
      nullif(item->>'responsible_id', '')::uuid, item->>'frequency',
      coalesce(nullif(item->>'day_type', ''), 'fixo'),
      nullif(item->>'day_of_month', '')::int,
      nullif(item->>'month', '')::int,
      case when item->'months' is null or item->'months' = 'null'::jsonb then null
        else array(select jsonb_array_elements_text(item->'months')::int) end,
      nullif(item->>'due_date', '')::date,
      coalesce(item->>'notes', ''),
      coalesce(nullif(item->>'priority', ''), 'media'),
      coalesce(nullif(item->>'business_day_shift', ''), 'nenhum'),
      coalesce((item->>'requires_validation')::boolean, true),
      nullif(item->>'validator_id', '')::uuid,
      auth.uid()
    from jsonb_array_elements(p_items) as source(item)
    returning *;
end;
$$;

revoke all on function public.import_obligations(jsonb) from public;
grant execute on function public.import_obligations(jsonb) to authenticated;

-- Evita que a função recém-criada continue respondendo 404 no PostgREST.
notify pgrst, 'reload schema';
