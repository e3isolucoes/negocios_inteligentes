-- Evolui o cadastro de obrigações para uma gestão modular de atividades.
-- Mantemos os nomes físicos existentes para uma migração compatível, enquanto
-- tipo, processo, área e dependência formam a esteira operacional.
alter table public.obligations
  add column if not exists activity_type text not null default 'obrigacao_acessoria',
  add column if not exists process_name text not null default '',
  add column if not exists area_name text not null default '',
  add column if not exists predecessor_id uuid references public.obligations(id) on delete set null,
  add column if not exists requires_attachment_no_movement boolean not null default true;

alter table public.obligations drop constraint if exists obligations_activity_type_check;
alter table public.obligations add constraint obligations_activity_type_check
  check (activity_type in ('obrigacao_acessoria', 'rotina', 'tarefa', 'marco'));
alter table public.obligations drop constraint if exists obligations_predecessor_not_self_check;
alter table public.obligations add constraint obligations_predecessor_not_self_check
  check (predecessor_id is null or predecessor_id <> id);

create index if not exists obligations_process_area_idx
  on public.obligations (workspace_id, process_name, area_name);
create index if not exists obligations_predecessor_idx on public.obligations(predecessor_id);

alter table public.completions
  add column if not exists movement_status text not null default 'nao_informado';
alter table public.completions drop constraint if exists completions_movement_status_check;
alter table public.completions add constraint completions_movement_status_check
  check (movement_status in ('nao_informado', 'com_movimento', 'sem_movimento'));

-- A ausência de comprovante só é aceita para uma obrigação acessória marcada
-- como sem movimento e explicitamente configurada para essa dispensa.
create or replace function public.enforce_completion_attachment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  activity public.obligations%rowtype;
  attachment_required boolean;
begin
  select * into activity from public.obligations where id = new.obligation_id;
  attachment_required := coalesce(activity.requires_attachment, true);

  if activity.activity_type = 'obrigacao_acessoria'
    and new.movement_status = 'sem_movimento'
    and activity.requires_attachment_no_movement = false then
    attachment_required := false;
  end if;

  if new.attachment_path is null and attachment_required then
    raise exception 'Comprovante obrigatório para esta atividade'
      using errcode = '23514', constraint = 'completions_attachment_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_completion_attachment on public.completions;
create trigger trg_enforce_completion_attachment
before insert or update of obligation_id, attachment_path, movement_status on public.completions
for each row execute function public.enforce_completion_attachment();
