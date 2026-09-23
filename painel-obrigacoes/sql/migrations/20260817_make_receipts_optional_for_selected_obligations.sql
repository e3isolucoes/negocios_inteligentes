-- Permite concluir rotinas que não geram um comprovante sem enfraquecer a
-- exigência para as demais obrigações. A regra também é aplicada no banco,
-- evitando que uma chamada direta à API contorne a configuração.
alter table public.obligations
  add column if not exists requires_attachment boolean not null default true;

with exceptions(name, category) as (values
  ('Parametrização do novo plano de contas nas regras de contabilização', 'contabil'),
  ('Baixa e Conciliação de Pagamentos e tarifas - Mercado Livre', 'financeiro'),
  ('Cadastro de Parceiros', 'controladoria'),
  ('Conferência do contas a pagar Federal do dia (guias vencendo)', 'conformidade'),
  ('Escrituracao de notas fiscais de entrada', 'controladoria'),
  ('Extração dos relatórios - Mercado Livre', 'financeiro'),
  ('Importação e Validação Notas Fiscais Mercado Livre', 'controladoria'),
  ('Backup de responsaveis (cobertura de ferias e ausencias)', 'federal'),
  ('Revisão estrutural de Societaria: markup | margem de contribuição por linha/NCM | ponto de equilíbrio | elasticidade', 'societaria'),
  ('Renovacao/recadastramento da inscricao de substituto', 'federal'),
  ('Destaque de IBS/CBS na NF-e | NFC-e | CT-e e MDF-e', 'federal'),
  ('Politica de descontos e alcadas de aprovacao', 'societaria'),
  ('Atualizacao de MVA/IVA-ST | protocolos e convenios por UF', 'estadual'),
  ('Atualizacao desta matriz de obrigacoes', 'federal'),
  ('Monitoramento de rejeicoes e notas tecnicas (NT 2025.002-RTC)', 'federal'),
  ('Conciliacao bancaria', 'contabil'),
  ('Manutencao do cadastro tributario (NCM | CEST | CST IBS/CBS | cClassTrib)', 'federal'),
  ('Conciliacao faturamento x NF-e autorizadas x escrituracao', 'conformidade'),
  ('Controle de validade de certificados digitais e procuracoes', 'conformidade'),
  ('Depreciacao | amortizacao e controle do imobilizado', 'contabil'),
  ('Revisao do simulador de precos por NCM', 'societaria'),
  ('Conciliacao de contas patrimoniais (clientes | fornecedores | impostos | adiantamentos)', 'contabil'),
  ('Consulta ao DEC/SP e aos domicilios eletronicos das demais UFs', 'federal'),
  ('Consulta da caixa postal e-CAC (DTE)', 'conformidade'),
  ('Fechamento contabil mensal', 'contabil'),
  ('Varredura de notas não escrituradas | notas canceladas | inutilizadas e numeração faltante', 'federal'),
  ('Analise de margem de contribuicao por produto | cliente e canal', 'societaria'),
  ('Auditoria de creditos de PIS/COFINS e de ICMS', 'conformidade'),
  ('Analise de contas de resultado x orcamento', 'financeiro'),
  ('Comite de Reforma Tributaria - roadmap 2026/2027', 'federal'),
  ('Simulacao do impacto de IBS/CBS no preco (cenario 2027)', 'societaria'),
  ('Analise de divergencia de estoque Federal x fisico', 'societaria'),
  ('Planejamento Federal do exercício seguinte — em 2026 com foco na transição para CBS/IBS em 2027 (CBS plena | IPI reduzido a zero | fim gradual do PIS/COFINS)', 'federal'),
  ('Destaque de IBS/CBS - Simples Nacional', 'federal'),
  ('Revisão de vida útil | teste de recuperabilidade (impairment) e inventário do ativo imobilizado/CIAP', 'contabil'),
  ('Consulta de regularidade da IE de substituto por UF', 'estadual'),
  ('Revisao de contratos com impacto tributario', 'federal'),
  ('Revisão do plano de contas | plano de naturezas financeiras e dos centros de resultado', 'contabil'),
  ('Treinamento tecnico da equipe', 'federal')
)
update public.obligations o
set requires_attachment = false
from exceptions e
where lower(trim(o.name)) = lower(e.name)
  and translate(lower(trim(o.category)), 'áàâãéêíóôõúç', 'aaaaeeiooouc') = e.category;

alter table public.completions
  drop constraint if exists completions_attachment_required;

create or replace function public.enforce_completion_attachment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.attachment_path is null and coalesce((
    select o.requires_attachment
    from public.obligations o
    where o.id = new.obligation_id
  ), true) then
    raise exception 'Comprovante obrigatório para esta obrigação'
      using errcode = '23514', constraint = 'completions_attachment_required';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_completion_attachment on public.completions;
create trigger trg_enforce_completion_attachment
before insert or update of obligation_id, attachment_path on public.completions
for each row execute function public.enforce_completion_attachment();
