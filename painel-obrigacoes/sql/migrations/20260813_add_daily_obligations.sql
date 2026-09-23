-- Adiciona recorrência diária às obrigações já instaladas.
-- Execute no SQL Editor do Supabase antes de publicar o front-end.
alter table obligations drop constraint if exists obligations_frequency_check;
alter table obligations add constraint obligations_frequency_check
  check (frequency in ('diaria', 'mensal', 'trimestral', 'anual', 'pontual'));

alter table obligations drop constraint if exists frequency_fields_check;
alter table obligations add constraint frequency_fields_check check (
  (frequency = 'diaria') or
  (frequency = 'mensal' and day_of_month is not null) or
  (frequency = 'trimestral' and day_of_month is not null and months is not null) or
  (frequency = 'anual' and day_of_month is not null and month is not null) or
  (frequency = 'pontual' and due_date is not null)
);
