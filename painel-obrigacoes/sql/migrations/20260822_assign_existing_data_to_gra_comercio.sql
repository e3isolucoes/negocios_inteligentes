-- Identifica nominalmente o workspace que recebeu todos os dados anteriores
-- à implantação do isolamento multiempresa. O vínculo é feito pelo CNPJ para
-- não criar um segundo tenant nem alterar as chaves já gravadas nas tabelas
-- operacionais.
begin;

do $$
begin
  if not exists (
    select 1
    from public.workspaces
    where regexp_replace(coalesce(document, ''), '\D', '', 'g') = '00999175000154'
  ) then
    raise exception
      'Workspace legado 00.999.175/0001-54 não encontrado; o isolamento deve ser aplicado antes desta migração.';
  end if;
end
$$;

update public.workspaces
set name = 'GRA Comercio',
    access_status = 'full'
where regexp_replace(coalesce(document, ''), '\D', '', 'g') = '00999175000154';

notify pgrst, 'reload schema';
commit;
