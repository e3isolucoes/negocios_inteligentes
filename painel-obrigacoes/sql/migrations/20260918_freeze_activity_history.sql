-- Congela o contexto histórico de cada atividade/conclusão.
-- Alterações futuras na estrutura da obrigação não podem reescrever
-- competência, vencimento ou demais dados já realizados.
begin;

alter table public.obligations
  add column if not exists structure_history jsonb not null default '[]'::jsonb;

alter table public.completions
  add column if not exists competence_date date;

alter table public.completions
  add column if not exists obligation_snapshot jsonb;

create or replace function public.completion_competence_date(
  p_occurrence_date date,
  p_offset_months integer
)
returns date
language sql
immutable
set search_path = public
as $$
  select (
    date_trunc('month', p_occurrence_date::timestamp)
    - make_interval(months => greatest(0, least(36, coalesce(p_offset_months, 0))))
  )::date;
$$;

create or replace function public.obligation_history_snapshot(p_obligation public.obligations)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company_name text := '';
begin
  if p_obligation.company_id is not null then
    select coalesce(name, '') into v_company_name
    from public.companies
    where id = p_obligation.company_id;
  end if;

  return jsonb_build_object(
    'name', p_obligation.name,
    'category', p_obligation.category,
    'company_id', p_obligation.company_id,
    'company_name', coalesce(v_company_name, ''),
    'responsible', p_obligation.responsible,
    'responsible_id', p_obligation.responsible_id,
    'frequency', p_obligation.frequency,
    'day_of_month', p_obligation.day_of_month,
    'month', p_obligation.month,
    'months', p_obligation.months,
    'due_date', p_obligation.due_date,
    'competence_offset_months', p_obligation.competence_offset_months,
    'notes', p_obligation.notes,
    'activity_type', p_obligation.activity_type,
    'process_name', p_obligation.process_name,
    'area_name', p_obligation.area_name,
    'predecessor_id', p_obligation.predecessor_id,
    'module_key', p_obligation.module_key,
    'requires_attachment', p_obligation.requires_attachment,
    'requires_attachment_no_movement', p_obligation.requires_attachment_no_movement,
    'priority', p_obligation.priority,
    'adjust_business_day', p_obligation.adjust_business_day,
    'day_type', p_obligation.day_type,
    'business_day_shift', p_obligation.business_day_shift,
    'requires_validation', p_obligation.requires_validation,
    'validator_id', p_obligation.validator_id
  );
end;
$$;

-- Congela o estado ATUAL das conclusões antigas antes que novas mudanças
-- estruturais possam alterar sua representação histórica.
update public.completions c
set
  competence_date = coalesce(
    c.competence_date,
    public.completion_competence_date(c.occurrence_date, o.competence_offset_months)
  ),
  obligation_snapshot = coalesce(
    c.obligation_snapshot,
    public.obligation_history_snapshot(o)
  )
from public.obligations o
where c.obligation_id = o.id
  and (c.competence_date is null or c.obligation_snapshot is null);

create or replace function public.freeze_completion_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obligation public.obligations;
begin
  select * into v_obligation
  from public.obligations
  where id = new.obligation_id;

  if not found then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.competence_date := coalesce(
      new.competence_date,
      public.completion_competence_date(new.occurrence_date, v_obligation.competence_offset_months)
    );
    new.obligation_snapshot := coalesce(
      new.obligation_snapshot,
      public.obligation_history_snapshot(v_obligation)
    );
  else
    -- O histórico é imutável. Updates de anexo/validação não podem alterar
    -- a competência nem o contexto estrutural congelado.
    new.competence_date := old.competence_date;
    new.obligation_snapshot := old.obligation_snapshot;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_freeze_completion_history_insert on public.completions;
create trigger trg_freeze_completion_history_insert
before insert on public.completions
for each row execute function public.freeze_completion_history();

drop trigger if exists trg_freeze_completion_history_update on public.completions;
create trigger trg_freeze_completion_history_update
before update on public.completions
for each row execute function public.freeze_completion_history();

create or replace function public.preserve_obligation_structure_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  v_changed :=
    new.name is distinct from old.name
    or new.category is distinct from old.category
    or new.company_id is distinct from old.company_id
    or new.responsible is distinct from old.responsible
    or new.responsible_id is distinct from old.responsible_id
    or new.frequency is distinct from old.frequency
    or new.day_of_month is distinct from old.day_of_month
    or new.month is distinct from old.month
    or new.months is distinct from old.months
    or new.due_date is distinct from old.due_date
    or new.competence_offset_months is distinct from old.competence_offset_months
    or new.notes is distinct from old.notes
    or new.activity_type is distinct from old.activity_type
    or new.process_name is distinct from old.process_name
    or new.area_name is distinct from old.area_name
    or new.predecessor_id is distinct from old.predecessor_id
    or new.module_key is distinct from old.module_key
    or new.requires_attachment is distinct from old.requires_attachment
    or new.requires_attachment_no_movement is distinct from old.requires_attachment_no_movement
    or new.priority is distinct from old.priority
    or new.adjust_business_day is distinct from old.adjust_business_day
    or new.day_type is distinct from old.day_type
    or new.business_day_shift is distinct from old.business_day_shift
    or new.requires_validation is distinct from old.requires_validation
    or new.validator_id is distinct from old.validator_id;

  if v_changed then
    new.structure_history :=
      coalesce(old.structure_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'effective_until', now(),
        'snapshot', public.obligation_history_snapshot(old)
      ));
  else
    new.structure_history := old.structure_history;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preserve_obligation_structure_history on public.obligations;
create trigger trg_preserve_obligation_structure_history
before update on public.obligations
for each row execute function public.preserve_obligation_structure_history();

commit;

notify pgrst, 'reload schema';
