-- =============================================================================
-- Painel de Obrigações Acessórias — schema relacional (Supabase / Postgres)
-- =============================================================================
-- Este script substitui o modelo antigo de "documento único" (tabela
-- board_state com uma linha JSONB) por tabelas relacionais, com Row Level
-- Security (RLS) e dois papéis de acesso: admin e membro.
--
-- Rode este script inteiro de uma vez no SQL Editor do Supabase, num projeto
-- novo (ou depois de apagar a tabela antiga board_state, se for migrar um
-- projeto existente — veja o bloco de migração comentado no final).
--
-- O script é seguro para rodar mais de uma vez no mesmo projeto (idempotente):
-- tabelas, políticas, funções e gatilhos são recriados sem gerar erro de
-- "já existe" se você rodar tudo de novo (por exemplo, depois de atualizar
-- este arquivo numa versão futura do painel).
-- =============================================================================

-- Extensão necessária para gen_random_uuid()
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) PERFIS (papéis de acesso: admin | gestor | membro)
-- -----------------------------------------------------------------------------
-- Cada usuário autenticado tem um perfil. O perfil é criado automaticamente
-- (via trigger, abaixo) quando você cria a conta da pessoa em
-- Authentication → Users. Por padrão todo mundo entra como "membro"; você
-- promove alguém a "admin" rodando um UPDATE (ver passo 5 do SETUP.md).

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'membro' check (role in ('admin','gestor','membro')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Garante a coluna também em projetos que já tinham a tabela profiles de
-- antes de "active" existir (o "create table if not exists" acima não
-- adiciona coluna em tabela já existente). Precisa vir ANTES de is_admin()
-- logo abaixo, porque essa função referencia "active" na própria definição
-- — se a coluna ainda não existir na hora de criar a função, o CREATE
-- FUNCTION falha com "column active does not exist" (é uma função "language
-- sql", validada contra o schema atual na hora de ser criada).
alter table profiles add column if not exists active boolean not null default true;
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','gestor','membro'));

-- Função auxiliar "is_admin": usada dentro das políticas de segurança para
-- checar o papel do usuário logado sem causar recursão infinita nas regras
-- da própria tabela profiles (por isso é "security definer"). Uma conta
-- revogada (active = false) deixa de contar como admin imediatamente, mesmo
-- que o papel salvo continue sendo 'admin' — assim revogar alguém já tira o
-- acesso de escrita em todo canto que depende de is_admin(), sem precisar
-- duplicar a checagem de "active" em cada política.
create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role = 'admin' and active from profiles where id = uid), false);
$$;

create or replace function is_manager(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role in ('admin', 'gestor') and active from profiles where id = uid), false);
$$;

-- Cria o perfil automaticamente quando uma conta nova é criada em
-- Authentication → Users (mantém o fluxo de "admin cadastra a equipe" do
-- painel original, sem cadastro público).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, split_part(new.email, '@', 1), 'membro')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on profiles;
create policy "profiles_select_authenticated"
  on profiles for select
  to authenticated
  using (true);

-- Só admin pode alterar papel/nome/status de outras pessoas. Qualquer
-- pessoa pode alterar o próprio display_name (mas não o próprio "role" nem
-- "active" — isso é bloqueado abaixo por um gatilho, para ninguém
-- conseguir se autopromover nem se "desrevogar" sozinho).
drop policy if exists "profiles_update_admin_or_self" on profiles;
create policy "profiles_update_admin_or_self"
  on profiles for update
  to authenticated
  using (is_admin(auth.uid()) or id = auth.uid())
  with check (is_admin(auth.uid()) or id = auth.uid());

create or replace function prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só bloqueia quando a alteração vem de uma sessão autenticada comum
  -- (front-end, via PostgREST/RLS) e essa pessoa não é admin. Quando
  -- auth.uid() é nulo, a gravação está vindo de fora desse contexto — por
  -- exemplo, do SQL Editor do Supabase, usado no bootstrap do primeiro
  -- administrador (passo 5 do SETUP.md) — e não deve ser bloqueada, pois
  -- quem tem acesso ao SQL Editor do projeto já tem confiança máxima.
  --
  -- Também cobre "active": sem isso, alguém revogado poderia reverter a
  -- própria revogação com um UPDATE direto (a policy acima libera update
  -- na própria linha para qualquer coluna, já que o único uso legítimo do
  -- self-update é trocar o display_name).
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and auth.uid() is not null
     and not is_admin(auth.uid()) then
    raise exception 'Só um administrador pode alterar papéis de acesso ou revogar/reativar contas.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_escalation on profiles;
create trigger trg_prevent_self_role_escalation
  before update on profiles
  for each row execute function prevent_self_role_escalation();

-- -----------------------------------------------------------------------------
-- 2) EMPRESAS
-- -----------------------------------------------------------------------------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table companies enable row level security;

drop policy if exists "companies_select_authenticated" on companies;
create policy "companies_select_authenticated"
  on companies for select
  to authenticated
  using (true);

drop policy if exists "companies_insert_admin" on companies;
create policy "companies_insert_admin"
  on companies for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "companies_update_admin" on companies;
create policy "companies_update_admin"
  on companies for update
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists "companies_delete_admin" on companies;
create policy "companies_delete_admin"
  on companies for delete
  to authenticated
  using (is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 3) OBRIGAÇÕES
-- -----------------------------------------------------------------------------
create table if not exists obligations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('federal','estadual','municipal','trabalhista','societaria')),
  company_id uuid references companies(id) on delete set null,
  responsible text not null default '',
  responsible_id uuid references profiles(id) on delete set null,
  frequency text not null check (frequency in ('diaria','mensal','trimestral','anual','pontual')),
  day_of_month int check (day_of_month between 1 and 31),
  month int check (month between 1 and 12),
  months int[],
  due_date date,
  notes text not null default '',
  activity_type text not null default 'obrigacao_acessoria' check (activity_type in ('obrigacao_acessoria','rotina','tarefa','marco')),
  process_name text not null default '',
  area_name text not null default '',
  predecessor_id uuid references obligations(id) on delete set null,
  requires_attachment boolean not null default true,
  requires_attachment_no_movement boolean not null default true,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frequency_fields_check check (
    (frequency = 'diaria') or
    (frequency = 'mensal'     and day_of_month is not null) or
    (frequency = 'trimestral' and day_of_month is not null and months is not null) or
    (frequency = 'anual'      and day_of_month is not null and month is not null) or
    (frequency = 'pontual'    and due_date is not null)
  )
);

create index if not exists obligations_company_idx on obligations(company_id);
create index if not exists obligations_frequency_idx on obligations(frequency);

-- Garante a coluna em projetos que já rodaram uma versão anterior deste
-- script (create table if not exists não adiciona colunas novas a uma
-- tabela que já existe — por isso o ALTER explícito abaixo).
alter table obligations add column if not exists responsible_id uuid references profiles(id) on delete set null;
create index if not exists obligations_responsible_id_idx on obligations(responsible_id);

alter table obligations enable row level security;
-- A função SECURITY DEFINER de importação (definida mais abaixo) é criada
-- pelo mesmo proprietário da tabela e precisa continuar podendo atravessar
-- a RLS depois de validar o administrador. FORCE ROW LEVEL SECURITY pode ter
-- sido habilitado manualmente em projetos antigos e faria até o proprietário
-- cair na policy do chamador, reproduzindo o erro "new row violates...".
alter table obligations no force row level security;

drop policy if exists "obligations_select_authenticated" on obligations;
create policy "obligations_select_authenticated"
  on obligations for select
  to authenticated
  using (true);

drop policy if exists "obligations_insert_admin" on obligations;
create policy "obligations_insert_admin"
  on obligations for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "obligations_update_admin" on obligations;
create policy "obligations_update_admin"
  on obligations for update
  to authenticated
  using (is_manager(auth.uid()))
  with check (is_manager(auth.uid()));

drop policy if exists "obligations_delete_admin" on obligations;
create policy "obligations_delete_admin"
  on obligations for delete
  to authenticated
  using (is_manager(auth.uid()));

-- Mantém updated_at e updated_by em dia automaticamente a cada UPDATE.
create or replace function touch_obligation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_obligation on obligations;
create trigger trg_touch_obligation
  before update on obligations
  for each row execute function touch_obligation();

-- -----------------------------------------------------------------------------
-- 4) CONCLUSÕES (histórico de "quem concluiu e quando")
-- -----------------------------------------------------------------------------
-- Uma linha por ocorrência concluída (obrigação + data da ocorrência).
-- "unique" impede duplicidade se duas pessoas clicarem "concluir" ao mesmo
-- tempo — a segunda gravação simplesmente falha com erro de duplicidade,
-- em vez de sobrescrever silenciosamente o registro da primeira.
create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id) on delete cascade,
  occurrence_date date not null,
  done_by uuid references profiles(id),
  done_by_name text not null,
  done_at timestamptz not null default now(),
  movement_status text not null default 'nao_informado' check (movement_status in ('nao_informado','com_movimento','sem_movimento')),
  unique (obligation_id, occurrence_date)
);

create index if not exists completions_obligation_idx on completions(obligation_id);

alter table completions enable row level security;

drop policy if exists "completions_select_authenticated" on completions;
create policy "completions_select_authenticated"
  on completions for select
  to authenticated
  using (true);

-- Qualquer pessoa autenticada pode marcar uma conclusão (isso é a ação do
-- dia a dia da equipe). O done_by é sempre o próprio usuário logado — a
-- política abaixo impede que alguém grave conclusão em nome de outra pessoa.
drop policy if exists "completions_insert_own" on completions;
create policy "completions_insert_own"
  on completions for insert
  to authenticated
  with check (done_by = auth.uid());

-- Desfazer: a própria pessoa pode desfazer o que ela concluiu; admin pode
-- desfazer qualquer conclusão (ex.: corrigir um clique errado de outra
-- pessoa do time).
drop policy if exists "completions_delete_own_or_admin" on completions;
create policy "completions_delete_own_or_admin"
  on completions for delete
  to authenticated
  using (done_by = auth.uid() or is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 5) PRIORIDADE (campo simples em obligations)
-- -----------------------------------------------------------------------------
-- Coluna aditiva — não afeta nenhuma obrigação já cadastrada (todas ficam
-- com 'media' por padrão). A validação dos valores permitidos é feita na
-- interface (dropdown fechado), não por CHECK constraint, para manter esta
-- migração simples de reaplicar.
alter table obligations add column if not exists priority text not null default 'media';

-- -----------------------------------------------------------------------------
-- 6) COMENTÁRIOS por obrigação
-- -----------------------------------------------------------------------------
create table if not exists obligation_comments (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id) on delete cascade,
  author_id uuid references profiles(id),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists obligation_comments_obligation_idx on obligation_comments(obligation_id);

alter table obligation_comments enable row level security;

drop policy if exists "obligation_comments_select_authenticated" on obligation_comments;
create policy "obligation_comments_select_authenticated"
  on obligation_comments for select
  to authenticated
  using (true);

drop policy if exists "obligation_comments_insert_own" on obligation_comments;
create policy "obligation_comments_insert_own"
  on obligation_comments for insert
  to authenticated
  with check (author_id = auth.uid());

drop policy if exists "obligation_comments_delete_own_or_admin" on obligation_comments;
create policy "obligation_comments_delete_own_or_admin"
  on obligation_comments for delete
  to authenticated
  using (author_id = auth.uid() or is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 7) TRILHA DE AUDITORIA (quem criou/editou/excluiu obrigações)
-- -----------------------------------------------------------------------------
-- Só admins conseguem consultar (dados de "quem fez o quê" são sensíveis).
-- Ninguém grava direto nesta tabela pela aplicação — só o gatilho abaixo
-- grava, via security definer, então nem RLS de insert é necessária: não
-- existe política de insert/update/delete para o papel "authenticated",
-- então a API bloqueia qualquer tentativa de escrita direta.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  changed_by uuid references profiles(id),
  changed_by_name text,
  changed_at timestamptz not null default now(),
  diff jsonb
);

create index if not exists audit_log_table_row_idx on audit_log(table_name, row_id);
create index if not exists audit_log_changed_at_idx on audit_log(changed_at desc);

alter table audit_log enable row level security;

drop policy if exists "audit_log_select_admin" on audit_log;
create policy "audit_log_select_admin"
  on audit_log for select
  to authenticated
  using (is_admin(auth.uid()));

create or replace function log_obligation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb;
  v_row_id uuid;
begin
  if tg_op = 'DELETE' then
    v_row_id := old.id;
    v_diff := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_row_id := new.id;
    v_diff := jsonb_build_object('antes', to_jsonb(old), 'depois', to_jsonb(new));
  else
    v_row_id := new.id;
    v_diff := to_jsonb(new);
  end if;

  insert into audit_log (table_name, row_id, action, changed_by, changed_by_name, diff)
  values (
    'obligations', v_row_id, lower(tg_op),
    auth.uid(),
    coalesce((select display_name from profiles where id = auth.uid()), 'sistema'),
    v_diff
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_obligation_insert on obligations;
create trigger trg_log_obligation_insert
  after insert on obligations
  for each row execute function log_obligation_change();

drop trigger if exists trg_log_obligation_update on obligations;
create trigger trg_log_obligation_update
  after update on obligations
  for each row execute function log_obligation_change();

drop trigger if exists trg_log_obligation_delete on obligations;
create trigger trg_log_obligation_delete
  after delete on obligations
  for each row execute function log_obligation_change();

-- Importa a planilha em uma única transação no banco. Fazer dezenas de
-- INSERTs pela API expunha cada lote separadamente à RLS e ainda obrigava o
-- navegador a tentar desfazer lotes anteriores (operação que também podia
-- ser recusada pela RLS). A função continua protegida: SECURITY DEFINER só
-- contorna a RLS depois de confirmar, no servidor, que a sessão é de admin.
create or replace function import_obligations(p_items jsonb)
returns setof obligations
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sessão expirada ou usuário não autenticado.';
  end if;
  if not is_admin(auth.uid()) then
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
    insert into obligations (
      name, category, company_id, responsible, responsible_id, frequency,
      day_type, day_of_month, month, months, due_date, notes, priority,
      business_day_shift, requires_validation, validator_id, created_by
    )
    select
      nullif(btrim(item->>'name'), ''),
      item->>'category',
      nullif(item->>'company_id', '')::uuid,
      coalesce(item->>'responsible', ''),
      nullif(item->>'responsible_id', '')::uuid,
      item->>'frequency',
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

-- Não deixa uma configuração de FORCE RLS antiga transformar esta RPC em um
-- INSERT comum sujeito à policy da sessão. Os clientes continuam sujeitos à
-- RLS; somente o proprietário (esta SECURITY DEFINER) a atravessa.
alter table obligations no force row level security;

revoke all on function import_obligations(jsonb) from public;
grant execute on function import_obligations(jsonb) to authenticated;

-- Faz o PostgREST descobrir a RPC imediatamente depois que este script é
-- executado, em vez de manter a definição antiga no cache de schema.
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 8) FERIADOS e ajuste para dia útil
-- -----------------------------------------------------------------------------
-- Escopo desta função: se a obrigação tiver adjust_business_day = true, o
-- painel empurra o vencimento calculado para a frente até cair num dia que
-- não seja sábado/domingo nem um feriado cadastrado aqui. Isso NÃO calcula
-- "o Nº-ésimo dia útil do mês" (regra que varia por tributo e é fácil de
-- calcular errado silenciosamente) — é um ajuste mais simples e seguro:
-- "não deixa vencer num fim de semana ou feriado".
create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  scope text not null default 'nacional' check (scope in ('nacional','estadual','municipal'))
);

alter table obligations add column if not exists adjust_business_day boolean not null default false;

alter table holidays enable row level security;

drop policy if exists "holidays_select_authenticated" on holidays;
create policy "holidays_select_authenticated"
  on holidays for select
  to authenticated
  using (true);

drop policy if exists "holidays_insert_admin" on holidays;
create policy "holidays_insert_admin"
  on holidays for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "holidays_delete_admin" on holidays;
create policy "holidays_delete_admin"
  on holidays for delete
  to authenticated
  using (is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 9) COMPROVANTES anexados às conclusões (Supabase Storage)
-- -----------------------------------------------------------------------------
-- Cria o bucket de armazenamento (privado — só autenticados acessam) e as
-- políticas de acesso aos arquivos. `on conflict do nothing` evita erro se
-- o bucket já existir (por exemplo, se você criou manualmente antes).
insert into storage.buckets (id, name, public)
values ('comprovantes', 'comprovantes', false)
on conflict (id) do nothing;

drop policy if exists "comprovantes_select_authenticated" on storage.objects;
create policy "comprovantes_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'comprovantes');

drop policy if exists "comprovantes_insert_authenticated" on storage.objects;
create policy "comprovantes_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'comprovantes');

drop policy if exists "comprovantes_delete_own_or_admin" on storage.objects;
create policy "comprovantes_delete_own_or_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'comprovantes' and (owner = auth.uid() or is_admin(auth.uid())));

-- Coluna que guarda o caminho do arquivo dentro do bucket, associada à
-- conclusão correspondente.
alter table completions add column if not exists attachment_path text;
alter table obligations add column if not exists requires_attachment boolean not null default true;

-- Exige comprovante nas obrigações comuns e permite que rotinas configuradas
-- com requires_attachment=false sejam concluídas sem arquivo. Um trigger é
-- necessário porque uma CHECK não pode consultar a obrigação relacionada.
alter table completions drop constraint if exists completions_attachment_required;
create or replace function enforce_completion_attachment() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.attachment_path is null and coalesce((
    select o.requires_attachment from obligations o where o.id=new.obligation_id
  ), true) then
    raise exception 'Comprovante obrigatório para esta obrigação'
      using errcode='23514', constraint='completions_attachment_required';
  end if;
  return new;
end $$;
drop trigger if exists trg_enforce_completion_attachment on completions;
create trigger trg_enforce_completion_attachment
before insert or update of obligation_id, attachment_path on completions
for each row execute function enforce_completion_attachment();

-- -----------------------------------------------------------------------------
-- 10) DIA ÚTIL FISCAL (Nº-ésimo dia útil do mês)
-- -----------------------------------------------------------------------------
-- day_type = 'fixo'        → day_of_month é o dia corrido de sempre (ex.: dia 20).
-- day_type = 'util_do_mes' → day_of_month passa a significar "o Nº-ésimo dia
--                             útil do mês" (ex.: 3 = terceiro dia útil),
--                             contando a partir do dia 1, pulando fins de
--                             semana e os feriados cadastrados em `holidays`.
alter table obligations add column if not exists day_type text not null default 'fixo';

-- -----------------------------------------------------------------------------
-- 11) CHECKLIST por obrigação
-- -----------------------------------------------------------------------------
-- Lista de passos (modelo) cadastrada pelo admin em cada obrigação. O
-- progresso de marcar/desmarcar item é conduzido dentro do próprio diálogo
-- de "concluir" (não fica salvo linha a linha no banco) — o checklist serve
-- para garantir que a pessoa não esqueça uma etapa antes de concluir, não
-- como um segundo histórico de auditoria por item.
create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id) on delete cascade,
  description text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists checklist_items_obligation_idx on checklist_items(obligation_id);

alter table checklist_items enable row level security;

drop policy if exists "checklist_items_select_authenticated" on checklist_items;
create policy "checklist_items_select_authenticated"
  on checklist_items for select
  to authenticated
  using (true);

drop policy if exists "checklist_items_insert_admin" on checklist_items;
create policy "checklist_items_insert_admin"
  on checklist_items for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "checklist_items_update_admin" on checklist_items;
create policy "checklist_items_update_admin"
  on checklist_items for update
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists "checklist_items_delete_admin" on checklist_items;
create policy "checklist_items_delete_admin"
  on checklist_items for delete
  to authenticated
  using (is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 12) PROGRESSO DO CHECKLIST na conclusão
-- -----------------------------------------------------------------------------
-- Guarda só a CONTAGEM de itens do checklist e quantos estavam marcados no
-- momento em que a conclusão foi registrada — o suficiente para mostrar
-- "3/3 itens" na listagem sem abrir o modal de edição. Não é um registro
-- item a item: isso manteria o checklist como um segundo histórico de
-- auditoria, papel que já é do audit_log e do comprovante anexado (ver
-- README, seção "Prioridade, checklist, comentários e histórico").
-- Conclusões registradas antes desta coluna existir ficam com os dois
-- campos nulos (não se aplica / não foi registrado).
alter table completions add column if not exists checklist_total int;
alter table completions add column if not exists checklist_checked int;

-- A interface já bloqueia o botão "Concluir" até todo o checklist ser
-- marcado (ui/completeDialog.js). Esta constraint é a mesma trava em
-- profundidade também usada para o comprovante obrigatório
-- (enforce_completion_attachment): garante a regra mesmo que alguém
-- tente burlar a interface chamando a API diretamente. "NOT VALID" de
-- propósito, para não invalidar retroativamente conclusões antigas.
-- Obrigações sem checklist (checklist_total nulo ou zero) não são afetadas.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'completions_checklist_complete'
  ) then
    alter table completions
      add constraint completions_checklist_complete
      check (checklist_total is null or checklist_total = 0 or checklist_checked = checklist_total)
      not valid;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 13) CONFERÊNCIA DE COMPETÊNCIA do comprovante (OCR no navegador)
-- -----------------------------------------------------------------------------
-- O comprovante é lido por OCR direto no navegador (Tesseract.js, sem
-- serviço externo pago) ao anexar o arquivo, tentando achar a que
-- competência (mês/ano) o documento se refere e comparando com a
-- ocorrência sendo concluída. É uma conferência HEURÍSTICA (leitura de
-- texto de documento escaneado nunca é 100% confiável, e cada órgão
-- emite guia num layout diferente) — por isso não bloqueia a conclusão,
-- só avisa e pede uma confirmação extra da pessoa (ver ui/completeDialog.js
-- e js/ocr.js). Aqui só guardamos o resultado dessa conferência, para
-- aparecer na Visão Executiva e no e-mail diário para administradores.
alter table completions add column if not exists ocr_status text; -- 'ok' | 'mismatch' | 'not_checked'
alter table completions add column if not exists ocr_extracted_period text; -- ex.: "07/2026", ou nulo se não achou nada

-- -----------------------------------------------------------------------------
-- 14) REGRAS DE OBRIGAÇÕES (catálogo/modelos praticados pelo mercado)
-- -----------------------------------------------------------------------------
-- Um catálogo de obrigações-padrão (DCTFWeb, ECD, ICMS-ST etc.), mantido
-- pela gerência (admin), separado das obrigações reais de cada empresa
-- (tabela `obligations`). Serve como referência e como modelo de
-- preenchimento rápido ao cadastrar uma obrigação nova (ver
-- ui/ruleModal.js e o seletor "Usar modelo de mercado" em ui/modal.js) —
-- escolher uma regra só PRÉ-PREENCHE o formulário; não cria vínculo
-- permanente entre a obrigação e a regra, então editar ou excluir uma
-- regra depois nunca afeta obrigações já cadastradas a partir dela.
create table if not exists obligation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in ('federal','estadual','municipal','trabalhista','societaria')),
  frequency text not null check (frequency in ('mensal','trimestral','anual')),
  day_type text not null default 'fixo' check (day_type in ('fixo','util_do_mes')),
  day_of_month int not null check (day_of_month between 1 and 31),
  month int check (month between 1 and 12),
  months int[],
  adjust_business_day boolean not null default false,
  notes text not null default '',
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint obligation_rules_frequency_fields_check check (
    (frequency = 'mensal') or
    (frequency = 'trimestral' and months is not null) or
    (frequency = 'anual' and month is not null)
  )
);

alter table obligation_rules enable row level security;

drop policy if exists "obligation_rules_select_authenticated" on obligation_rules;
create policy "obligation_rules_select_authenticated"
  on obligation_rules for select
  to authenticated
  using (true);

drop policy if exists "obligation_rules_insert_admin" on obligation_rules;
create policy "obligation_rules_insert_admin"
  on obligation_rules for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "obligation_rules_update_admin" on obligation_rules;
create policy "obligation_rules_update_admin"
  on obligation_rules for update
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists "obligation_rules_delete_admin" on obligation_rules;
create policy "obligation_rules_delete_admin"
  on obligation_rules for delete
  to authenticated
  using (is_admin(auth.uid()));

create or replace function touch_obligation_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_obligation_rule on obligation_rules;
create trigger trg_touch_obligation_rule
  before update on obligation_rules
  for each row execute function touch_obligation_rule();

-- Seed com obrigações comuns no mercado brasileiro, só para dar um ponto de
-- partida — `on conflict (name) do nothing` faz rodar de novo sem duplicar
-- nem sobrescrever o que a gerência já tiver customizado. As datas abaixo
-- são referências de mercado amplamente praticadas, não aconselhamento
-- tributário: confirme sempre contra a legislação/calendário oficial
-- vigente antes de usar como modelo (prazos mudam por lei, prorrogação ou
-- particularidade de UF/município).
insert into obligation_rules (name, category, frequency, day_type, day_of_month, month, months, adjust_business_day, notes) values
  ('DCTFWeb', 'federal', 'mensal', 'util_do_mes', 15, null, null, false, 'Declaração de Débitos e Créditos Tributários Federais (substitui GFIP). Confira o calendário RFB do ano vigente.'),
  ('EFD Contribuições (PIS/COFINS)', 'federal', 'mensal', 'util_do_mes', 10, null, null, false, 'Escrituração Fiscal Digital de PIS/COFINS. Confira o calendário RFB do ano vigente.'),
  ('FGTS (GRF)', 'trabalhista', 'mensal', 'fixo', 7, null, null, true, 'Guia de Recolhimento do FGTS. Se dia 7 cair em fim de semana/feriado, antecipar (ajuste no painel empurra para frente — confirme se sua prática é antecipar em vez de adiar).'),
  ('DAS — Simples Nacional', 'federal', 'mensal', 'fixo', 20, null, null, true, 'Documento de Arrecadação do Simples Nacional. Empurra para o próximo dia útil quando cai em fim de semana/feriado.'),
  ('ICMS-ST (substituição tributária)', 'estadual', 'trimestral', 'fixo', 20, null, array[3,6,9,12], true, 'Regra geral de referência — varia por UF e por convênio/protocolo. Confira a legislação do estado da empresa.'),
  ('ISS — Município', 'municipal', 'mensal', 'fixo', 10, null, null, true, 'Prazo varia muito por município — confirme na legislação municipal específica antes de usar como modelo.'),
  ('ECD — Escrituração Contábil Digital', 'societaria', 'anual', 'fixo', 31, 5, null, true, 'SPED Contábil. Prazo costuma ser o último dia útil de maio — confira o calendário SPED do ano vigente.'),
  ('ECF — Escrituração Contábil Fiscal', 'federal', 'anual', 'fixo', 31, 7, null, true, 'SPED Fiscal (IRPJ/CSLL). Prazo costuma ser o último dia útil de julho — confira o calendário SPED do ano vigente.')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- 15) EXCEÇÃO DE DATA por ocorrência (prorrogação pontual)
-- -----------------------------------------------------------------------------
-- Ajusta o vencimento de UMA ocorrência específica (ex.: "o prazo de maio
-- foi prorrogado para 30/06 esse ano"), sem tocar na regra de recorrência
-- da obrigação — as próximas ocorrências continuam seguindo
-- day_of_month/month/months normalmente. `original_date` é a data que o
-- painel teria calculado sozinho (chave natural da ocorrência sendo
-- ajustada); `override_date` é a data efetiva. A conclusão continua sendo
-- registrada com `original_date` como `completions.occurrence_date` — o
-- ajuste muda só o que aparece na tela (vencimento, status atrasada/no
-- prazo), não a identidade da ocorrência nem o histórico.
create table if not exists obligation_date_overrides (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id) on delete cascade,
  original_date date not null,
  override_date date not null,
  reason text not null default '',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (obligation_id, original_date)
);

create index if not exists obligation_date_overrides_obligation_idx on obligation_date_overrides(obligation_id);

alter table obligation_date_overrides enable row level security;

drop policy if exists "obligation_date_overrides_select_authenticated" on obligation_date_overrides;
create policy "obligation_date_overrides_select_authenticated"
  on obligation_date_overrides for select
  to authenticated
  using (true);

drop policy if exists "obligation_date_overrides_insert_admin" on obligation_date_overrides;
create policy "obligation_date_overrides_insert_admin"
  on obligation_date_overrides for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "obligation_date_overrides_update_admin" on obligation_date_overrides;
create policy "obligation_date_overrides_update_admin"
  on obligation_date_overrides for update
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists "obligation_date_overrides_delete_admin" on obligation_date_overrides;
create policy "obligation_date_overrides_delete_admin"
  on obligation_date_overrides for delete
  to authenticated
  using (is_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- 16) REGIMES TRIBUTÁRIOS e suas obrigações-padrão
-- -----------------------------------------------------------------------------
-- Catálogo de regimes tributários (Simples Nacional, Lucro Presumido, Lucro
-- Real, MEI etc.), mantido pela gerência (perfil admin) — mesma lógica de
-- "catálogo de mercado" já usada em obligation_rules. Cada empresa fica
-- vinculada a NO MÁXIMO um regime por vez (é como funciona na prática:
-- uma empresa está enquadrada em um único regime tributário de cada vez).
create table if not exists tax_regimes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tax_regimes enable row level security;

drop policy if exists "tax_regimes_select_authenticated" on tax_regimes;
create policy "tax_regimes_select_authenticated"
  on tax_regimes for select
  to authenticated
  using (true);

drop policy if exists "tax_regimes_insert_admin" on tax_regimes;
create policy "tax_regimes_insert_admin"
  on tax_regimes for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "tax_regimes_update_admin" on tax_regimes;
create policy "tax_regimes_update_admin"
  on tax_regimes for update
  to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

drop policy if exists "tax_regimes_delete_admin" on tax_regimes;
create policy "tax_regimes_delete_admin"
  on tax_regimes for delete
  to authenticated
  using (is_admin(auth.uid()));

create or replace function touch_tax_regime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_tax_regime on tax_regimes;
create trigger trg_touch_tax_regime
  before update on tax_regimes
  for each row execute function touch_tax_regime();

-- Quais obrigações do catálogo (obligation_rules) são praticadas em cada
-- regime — M:N porque uma mesma obrigação (ex.: FGTS) costuma valer para
-- vários regimes ao mesmo tempo.
create table if not exists tax_regime_rules (
  tax_regime_id uuid not null references tax_regimes(id) on delete cascade,
  obligation_rule_id uuid not null references obligation_rules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tax_regime_id, obligation_rule_id)
);

alter table tax_regime_rules enable row level security;

drop policy if exists "tax_regime_rules_select_authenticated" on tax_regime_rules;
create policy "tax_regime_rules_select_authenticated"
  on tax_regime_rules for select
  to authenticated
  using (true);

drop policy if exists "tax_regime_rules_insert_admin" on tax_regime_rules;
create policy "tax_regime_rules_insert_admin"
  on tax_regime_rules for insert
  to authenticated
  with check (is_admin(auth.uid()));

drop policy if exists "tax_regime_rules_delete_admin" on tax_regime_rules;
create policy "tax_regime_rules_delete_admin"
  on tax_regime_rules for delete
  to authenticated
  using (is_admin(auth.uid()));

-- Vínculo empresa → regime (nullable: empresa pode não ter regime definido
-- ainda). "on delete set null" para excluir um regime não apagar empresas.
alter table companies add column if not exists tax_regime_id uuid references tax_regimes(id) on delete set null;

-- Checklist-padrão de uma regra do catálogo (um passo por linha) — copiado
-- para checklist_items de cada obrigação criada a partir da regra (uso
-- manual "usar como modelo" ou automático ao "trazer obrigações do
-- regime"). Fica vazio por padrão; não é obrigatório preencher.
alter table obligation_rules add column if not exists checklist_template text[] not null default '{}';

-- Seed de regimes tributários comuns no Brasil. "on conflict (name) do
-- nothing" — roda de novo sem duplicar nem sobrescrever customização feita
-- pela gerência depois.
insert into tax_regimes (name, description) values
  ('Simples Nacional', 'Regime unificado para micro e pequenas empresas (Lei Complementar 123/2006) — tributos federais, estaduais e municipais recolhidos numa guia única (DAS).'),
  ('Lucro Presumido', 'IRPJ/CSLL calculados sobre uma margem de lucro presumida por lei conforme a atividade, em vez do lucro contábil real.'),
  ('Lucro Real', 'IRPJ/CSLL incidem sobre o lucro contábil efetivamente apurado, com ajustes fiscais — obrigatório acima de certo faturamento ou para setores específicos (ex.: instituições financeiras).'),
  ('MEI', 'Microempreendedor Individual — regime simplificado com tributos fixos mensais (DAS-MEI), limitado a um teto de faturamento anual e a até um empregado.')
on conflict (name) do nothing;

-- Vínculo inicial entre o seed de regimes acima e o seed de obligation_rules
-- já existente (seção 14). É uma referência SIMPLIFICADA e de uso geral —
-- não é aconselhamento tributário, nem uma integração com nenhuma base de
-- dados oficial do Governo (não existe hoje uma API pública estruturada e
-- gratuita com essa relação regime→obrigação pronta para consumo). Trata-se
-- de um ponto de partida curado manualmente a partir de prática de mercado;
-- CONFIRME sempre contra a legislação e o enquadramento fiscal específico
-- de cada empresa antes de usar como modelo (regras variam por UF,
-- município, atividade e faturamento).
insert into tax_regime_rules (tax_regime_id, obligation_rule_id)
select r.id, o.id
from tax_regimes r
join obligation_rules o on true
where (r.name, o.name) in (
  ('Simples Nacional', 'DAS — Simples Nacional'),
  ('Simples Nacional', 'FGTS (GRF)'),
  ('Lucro Presumido', 'DCTFWeb'),
  ('Lucro Presumido', 'EFD Contribuições (PIS/COFINS)'),
  ('Lucro Presumido', 'FGTS (GRF)'),
  ('Lucro Presumido', 'ICMS-ST (substituição tributária)'),
  ('Lucro Presumido', 'ISS — Município'),
  ('Lucro Presumido', 'ECF — Escrituração Contábil Fiscal'),
  ('Lucro Real', 'DCTFWeb'),
  ('Lucro Real', 'EFD Contribuições (PIS/COFINS)'),
  ('Lucro Real', 'FGTS (GRF)'),
  ('Lucro Real', 'ICMS-ST (substituição tributária)'),
  ('Lucro Real', 'ISS — Município'),
  ('Lucro Real', 'ECD — Escrituração Contábil Digital'),
  ('Lucro Real', 'ECF — Escrituração Contábil Fiscal'),
  ('MEI', 'FGTS (GRF)')
)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 17) CHECKLIST com progresso PERSISTENTE por item (ao vivo, entre sessões)
-- -----------------------------------------------------------------------------
-- Além da contagem final gravada em completions (seção 12), agora cada item
-- do checklist guarda seu próprio estado "marcado" — para o painel mostrar
-- o percentual de conclusão em tempo real (ex.: "2/5 — 40%") enquanto a
-- equipe vai resolvendo os passos ao longo do período, não só no instante
-- da conclusão final.
alter table checklist_items add column if not exists completed boolean not null default false;
alter table checklist_items add column if not exists completed_by uuid references profiles(id) on delete set null;
alter table checklist_items add column if not exists completed_at timestamptz;

-- Qualquer pessoa autenticada pode marcar/desmarcar um passo do checklist
-- (o mesmo modelo permissivo já usado para "Marcar concluído" — qualquer
-- membro da equipe pode concluir qualquer obrigação, não só o responsável).
-- A política de UPDATE da tabela continua admin-only (protege descrição e
-- posição dos passos, que são o "modelo" definido pela gerência); esta
-- função roda como "security definer" e só toca os três campos de estado
-- de conclusão, nunca descrição/posição/obligation_id — por isso pode ser
-- liberada para todo mundo sem abrir brecha para editar o checklist em si.
create or replace function set_checklist_item_done(p_item_id uuid, p_done boolean)
returns checklist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result checklist_items;
begin
  update checklist_items
    set completed = p_done,
        completed_by = case when p_done then auth.uid() else null end,
        completed_at = case when p_done then now() else null end
    where id = p_item_id
    returning * into result;
  return result;
end;
$$;

grant execute on function set_checklist_item_done(uuid, boolean) to authenticated;

-- Reinicia todos os itens do checklist de uma obrigação para "não
-- marcado" — chamado pelo app depois de registrar uma conclusão, para o
-- próximo ciclo começar do zero. Mesmo raciocínio de permissão da função
-- acima: qualquer pessoa autenticada pode concluir uma obrigação (não só
-- admin), então esta função também precisa rodar para todo mundo, mas só
-- toca o estado de conclusão dos itens — nunca descrição/posição.
create or replace function reset_checklist_items(p_obligation_id uuid)
returns setof checklist_items
language sql
security definer
set search_path = public
as $$
  update checklist_items
    set completed = false, completed_by = null, completed_at = null
    where obligation_id = p_obligation_id
    returning *;
$$;

grant execute on function reset_checklist_items(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 18) EMPURRAR ou ANTECIPAR o dia útil (fim de semana/feriado)
-- -----------------------------------------------------------------------------
-- Evolui o ajuste simples da seção 8 (adjust_business_day, só empurrava
-- para a frente) para dar a escolha de DIREÇÃO: empurrar para o próximo
-- dia útil (comportamento antigo) ou antecipar para o dia útil anterior —
-- útil para tributos cuja prática de mercado é antecipar o vencimento em
-- vez de adiar (ex.: FGTS, quando o dia 7 cai num fim de semana, costuma
-- ser antecipado, não adiado).
--
-- `adjust_business_day` continua existindo na tabela (excluir/renomear
-- coluna seria destrutivo) mas fica sem uso a partir desta versão — o
-- valor antigo é só aproveitado uma vez, no backfill abaixo, como ponto de
-- partida para quem já tinha o ajuste simples ligado.
alter table obligations add column if not exists business_day_shift text not null default 'nenhum'
  check (business_day_shift in ('nenhum', 'proximo_util', 'anterior_util'));
alter table obligation_rules add column if not exists business_day_shift text not null default 'nenhum'
  check (business_day_shift in ('nenhum', 'proximo_util', 'anterior_util'));

-- Backfill único a partir do valor antigo — só roda enquanto o valor novo
-- ainda estiver no padrão 'nenhum' e o antigo já sinalizava ajuste, então
-- rodar este script de novo não sobrescreve uma escolha explícita feita
-- depois (ex.: alguém que trocou para "anterior_util" na tela).
update obligations set business_day_shift = 'proximo_util'
  where adjust_business_day = true and business_day_shift = 'nenhum';
update obligation_rules set business_day_shift = 'proximo_util'
  where adjust_business_day = true and business_day_shift = 'nenhum';

-- -----------------------------------------------------------------------------
-- 19) REVOGAÇÃO DE ACESSO (conta ativa/revogada)
-- -----------------------------------------------------------------------------
-- Coluna `profiles.active` — criada lá na seção 1 (precisa vir antes de
-- is_admin(), que já depende dela). Revogar alguém NÃO apaga a conta de
-- autenticação nem o perfil (o app não tem a service role key para isso,
-- ver js/api/adminUsers.js) — só marca active = false. A partir daí:
--   * is_admin() já passa a ignorar o papel de quem foi revogado (seção 1)
--     — perde na hora qualquer escrita que dependa disso;
--   * o front-end verifica o próprio "active" a cada login/refresh de sessão
--     (js/app.js) e desconecta a pessoa se estiver revogada, mostrando um
--     aviso na tela de login.
-- Isso NÃO é um bloqueio a nível de RLS para tabelas de leitura geral (ex.:
-- obligations, companies) — um membro revogado com um token ainda válido em
-- outra aba continua lendo essas tabelas até o token expirar/atualizar,
-- porque essas políticas usam só "to authenticated". Suficiente para o caso
-- de uso (afastar alguém da equipe pela tela do painel), mas não é
-- equivalente a desativar a conta no painel do Supabase.

-- =============================================================================
-- Fim do schema. Próximo passo: veja o SETUP.md para criar o primeiro admin
-- e as contas da equipe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 20) CATEGORIAS DISPONÍVEIS NO AMBIENTE
-- -----------------------------------------------------------------------------
-- O CHECK original limitava silenciosamente o ambiente a cinco valores. O
-- catálogo abaixo vira a fonte de verdade e permite que a Gestão publique,
-- ordene, desative e crie categorias sem nova alteração de código.
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  descricao text,
  cor text not null default '#64748b' constraint categories_cor_check check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ordem integer not null default 100,
  ativo boolean not null default true,
  sistema boolean not null default false,
  exige_validacao boolean not null default true,
  validador_padrao_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into categories (name, cor, ordem, sistema) values
  ('federal', '#2563eb', 10, true), ('estadual', '#0891b2', 20, true),
  ('municipal', '#0d9488', 30, true), ('trabalhista', '#ca8a04', 40, true),
  ('societaria', '#9333ea', 50, true),
  -- Áreas administrativas ampliam o mesmo cadastro sem alterar obrigações,
  -- usuários, papéis ou políticas já existentes. Ambientes atuais recebem as
  -- opções de forma idempotente ao reaplicar o schema.
  ('administrativo', '#475569', 60, true), ('financeiro', '#047857', 70, true),
  ('pessoas', '#be185d', 80, true), ('comercial', '#c2410c', 90, true),
  ('operacoes', '#0369a1', 100, true), ('compras', '#7c3aed', 110, true),
  ('tecnologia', '#0f766e', 120, true), ('projetos', '#a21caf', 130, true)
on conflict (name) do update set ativo = true;

-- Remove somente os CHECKs antigos da coluna category, independentemente do
-- nome que o Postgres deu a eles. A FK passa a aceitar todo o catálogo.
do $$ declare c record; begin
  for c in
    select conname, conrelid from pg_constraint
    where conrelid in ('obligations'::regclass, 'obligation_rules'::regclass)
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table %s drop constraint %I',
      case when c.conrelid='obligations'::regclass
        then 'obligations' else 'obligation_rules' end, c.conname);
  end loop;
end $$;

alter table obligations drop constraint if exists obligations_category_fkey;
alter table obligations add constraint obligations_category_fkey foreign key (category)
  references categories(name) on update cascade;
alter table obligation_rules drop constraint if exists obligation_rules_category_fkey;
alter table obligation_rules add constraint obligation_rules_category_fkey foreign key (category)
  references categories(name) on update cascade;

alter table categories enable row level security;
drop policy if exists "categories_select_authenticated" on categories;
create policy "categories_select_authenticated" on categories for select to authenticated using (true);
drop policy if exists "categories_write_admin" on categories;
create policy "categories_write_admin" on categories for all to authenticated
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create or replace view vw_categorias_uso with (security_invoker=true) as
select c.*, count(o.id)::integer as obrigacoes, c.name as rotulo
from categories c left join obligations o on o.category=c.name
group by c.id;

create or replace function categoria_reclassificar(p_origem_id uuid, p_destino_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare origem text; destino text; qtd integer;
begin
  if not is_admin(auth.uid()) then raise exception 'Somente administradores'; end if;
  select name into origem from categories where id=p_origem_id;
  select name into destino from categories where id=p_destino_id and ativo;
  if origem is null or destino is null then raise exception 'Categoria inválida'; end if;
  update obligations set category=destino where category=origem;
  get diagnostics qtd = row_count;
  return qtd;
end $$;
grant execute on function categoria_reclassificar(uuid,uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 21) VALIDAÇÃO OBRIGATÓRIA ANTES DA CONCLUSÃO
-- -----------------------------------------------------------------------------
alter table obligations add column if not exists requires_validation boolean not null default true;
alter table obligations add column if not exists validator_id uuid references profiles(id) on delete set null;
update obligations set requires_validation=true;

alter table completions add column if not exists status text not null default 'aguardando_validacao';
alter table completions add column if not exists validator_id uuid references profiles(id) on delete set null;
alter table completions add column if not exists submitted_at timestamptz not null default now();
alter table completions add column if not exists validated_at timestamptz;
alter table completions add column if not exists validated_by uuid references profiles(id) on delete set null;
alter table completions add column if not exists rejection_reason text;
alter table completions drop constraint if exists completions_status_check;
alter table completions add constraint completions_status_check
  check (status in ('aguardando_validacao','rejeitada','validada'));

-- Histórico anterior permanece concluído; novos registros sempre entram na fila.
update completions set status='validada', validated_at=done_at
where validator_id is null and status='aguardando_validacao';

create or replace function preparar_validacao_conclusao()
returns trigger language plpgsql security definer set search_path=public as $$
declare v uuid; exigir boolean; executor_admin boolean;
begin
  select validator_id, requires_validation into v, exigir from obligations where id=new.obligation_id;
  executor_admin := is_admin(new.done_by);
  if exigir and not executor_admin and v is null then raise exception 'A Gestão ainda não definiu o validador desta tarefa'; end if;
  if exigir and not executor_admin and v=new.done_by then raise exception 'O executor não pode validar o próprio trabalho'; end if;
  new.validator_id := v;
  new.status := case when exigir and not executor_admin then 'aguardando_validacao' else 'validada' end;
  if not exigir or executor_admin then new.validated_at:=now(); new.validated_by:=new.done_by; end if;
  return new;
end $$;
drop trigger if exists trg_preparar_validacao_conclusao on completions;
create trigger trg_preparar_validacao_conclusao before insert on completions
for each row execute function preparar_validacao_conclusao();

drop policy if exists "completions_update_validation" on completions;
create policy "completions_update_validation" on completions for update to authenticated
using (validator_id=auth.uid() or (done_by=auth.uid() and status='rejeitada'))
with check (validator_id=auth.uid() or done_by=auth.uid());

create or replace function auditar_status_validacao()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.status='aguardando_validacao' and new.status in ('validada','rejeitada') then
    if old.validator_id<>auth.uid() then raise exception 'Somente o validador designado'; end if;
    new.validated_by:=auth.uid(); new.validated_at:=now();
    if new.status='validada' then new.rejection_reason:=null; end if;
  elsif old.status='rejeitada' and new.status='aguardando_validacao' then
    if old.done_by<>auth.uid() then raise exception 'Somente o executor pode reenviar'; end if;
    new.submitted_at:=now(); new.validated_by:=null; new.validated_at:=null; new.rejection_reason:=null;
  else
    raise exception 'Transição de validação inválida';
  end if;
  return new;
end $$;
drop trigger if exists trg_auditar_status_validacao on completions;
create trigger trg_auditar_status_validacao before update on completions
for each row execute function auditar_status_validacao();

create or replace view vw_aguardando_validacao with (security_invoker=true) as
select c.id completion_id, o.name obrigacao, co.name empresa, o.category categoria,
  cat.cor categoria_cor, c.occurrence_date, c.done_by_name, c.submitted_at,
  greatest(0,current_date-c.submitted_at::date) dias_esperando
from completions c join obligations o on o.id=c.obligation_id
left join companies co on co.id=o.company_id left join categories cat on cat.name=o.category
where c.status='aguardando_validacao' and (c.validator_id=auth.uid() or is_admin(auth.uid()));

create or replace view vw_rejeitadas with (security_invoker=true) as
select c.id completion_id,o.name obrigacao,co.name empresa,c.occurrence_date,
 c.rejection_reason motivo,p.display_name rejeitado_por,c.validated_at rejeitado_em
from completions c join obligations o on o.id=c.obligation_id
left join companies co on co.id=o.company_id left join profiles p on p.id=c.validated_by
where c.status='rejeitada' and (c.done_by=auth.uid() or is_admin(auth.uid()));

create or replace view vw_meus_envios_pendentes with (security_invoker=true) as
select c.id completion_id,o.name obrigacao,co.name empresa,c.occurrence_date,c.submitted_at,
 p.display_name aguardando_validacao_de,greatest(0,current_date-c.submitted_at::date) dias_esperando
from completions c join obligations o on o.id=c.obligation_id
left join companies co on co.id=o.company_id left join profiles p on p.id=c.validator_id
where c.status='aguardando_validacao' and c.done_by=auth.uid();

create or replace view vw_sem_validador with (security_invoker=true) as
select o.id,o.name obrigacao,co.name empresa from obligations o
left join companies co on co.id=o.company_id where o.requires_validation and o.validator_id is null;

create or replace view vw_validacao_desempenho with (security_invoker=true) as
select p.id validator_id,p.display_name validador,
 count(*) filter(where c.status='aguardando_validacao')::integer na_fila,
 count(*) filter(where c.status='validada')::integer aprovadas,
 count(*) filter(where c.status='rejeitada')::integer rejeitadas,
 round(avg(extract(epoch from (c.validated_at-c.submitted_at))/3600) filter(where c.validated_at is not null),1) horas_media,
 max(current_date-c.submitted_at::date) filter(where c.status='aguardando_validacao') maior_espera_dias
from profiles p left join completions c on c.validator_id=p.id group by p.id;

create or replace function definir_validador_categoria(p_categoria_id uuid,p_validador_id uuid,p_exigir boolean,p_aplicar_existentes boolean)
returns integer language plpgsql security definer set search_path=public as $$
declare chave text; qtd integer:=0;
begin
 if not is_admin(auth.uid()) then raise exception 'Somente a Gestão'; end if;
 if p_exigir and p_validador_id is null then raise exception 'Escolha um validador'; end if;
 update categories set exige_validacao=p_exigir,validador_padrao_id=p_validador_id where id=p_categoria_id returning name into chave;
 if p_aplicar_existentes then
   update obligations set requires_validation=p_exigir,validator_id=p_validador_id where category=chave;
   get diagnostics qtd=row_count;
 end if;
 return qtd;
end $$;
grant execute on function definir_validador_categoria(uuid,uuid,boolean,boolean) to authenticated;
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

-- Execute uma única vez para promover a conta proprietária:
-- update public.profiles set role = 'super_admin' where email = 'proprietario@exemplo.com';

-- Ask PostgREST to expose the new administration table immediately.
notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 17) BOOTSTRAP DO SUPERUSUÁRIO PROPRIETÁRIO
-- -----------------------------------------------------------------------------
-- O contexto administrativo do SQL Editor/migrações não possui auth.uid().
-- Ele pode fazer o bootstrap; sessões autenticadas continuam protegidas.
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

-- Marco recebe o papel tanto se a conta já existir quanto se ela for criada
-- somente depois da primeira execução deste schema.
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


-- -----------------------------------------------------------------------------
-- 18) HISTÓRICO IMUTÁVEL DE ATIVIDADE / COMPETÊNCIA
-- -----------------------------------------------------------------------------
-- Conclusões representam fatos históricos. Mudanças posteriores na estrutura
-- da obrigação não podem recalcular competência nem reescrever o contexto já
-- realizado.
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
returns date language sql immutable set search_path=public as $$
  select (
    date_trunc('month', p_occurrence_date::timestamp)
    - make_interval(months => greatest(0, least(36, coalesce(p_offset_months, 0))))
  )::date;
$$;

create or replace function public.obligation_history_snapshot(p_obligation public.obligations)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_company_name text := '';
begin
  if p_obligation.company_id is not null then
    select coalesce(name, '') into v_company_name
    from public.companies where id = p_obligation.company_id;
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

create or replace function public.freeze_completion_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_obligation public.obligations;
begin
  select * into v_obligation from public.obligations where id = new.obligation_id;
  if not found then return new; end if;
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
returns trigger language plpgsql security definer set search_path=public as $$
declare v_changed boolean;
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

notify pgrst, 'reload schema';
