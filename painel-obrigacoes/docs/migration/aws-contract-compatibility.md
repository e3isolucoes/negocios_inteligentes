# Compatibilidade de contrato frontend → AWS

**Data:** 09/09/2026  
**Escopo:** contrato do data plane AWS; nenhuma alteração em Supabase, nos fluxos
globais `adminUsers`/`workspaces` do frontend ou em infraestrutura implantada.

## Fontes de verdade

O levantamento partiu dos objetos enviados por `js/data.js` e pelos módulos em
`js/api/`, confrontados com `sql/schema.sql` e as migrações até
`20260826_add_administrative_modules.sql`. Fixtures de contrato reproduzem esses
objetos, em vez de inventar DTOs exclusivos do backend.

| Domínio | Campos de escrita confirmados |
|---|---|
| profiles | `id`, `email`, `display_name`, `role`, `active`, `module_access` |
| obligations | campos de recorrência, responsáveis, anexos, validação e atividade já existentes, mais `module_key` |
| completions | vínculo/ocorrência/executor, comprovante, checklist, OCR, movimento e ciclo de validação |
| categories | `name`, `descricao`, `cor`, `ordem`, `ativo`, `sistema`, `exige_validacao`, `validador_padrao_id` |
| checklist_items | definição (`obligation_id`, `description`, `position`) e progresso (`done`/`completed`, executor e data) |
| obligation_rules | recorrência, calendário, notas e `checklist_template` |
| workspaces | `name`, `document`, `access_status`, `trial_ends_at` |

`workspace_id` continua deliberadamente fora de todos os DTOs. O tenant é sempre
derivado da membership autenticada e usado na PK e nas consultas de relações.
Referências são lidas consistentemente na mesma partição antes da transação.

## Decisões de canonicalização

### Papéis

A representação persistida pela AWS é exclusivamente `member`, `manager`,
`admin`, `super_admin`. O adapter central aceita, na borda, os aliases legados
`membro`, `gestor` e `administrador`, e converte registros DynamoDB legados na
leitura. O mesmo adapter é usado na autenticação de memberships. Assim, nenhuma
regra de autorização precisa conhecer traduções PT-BR.

Um `admin` não pode conceder ou alterar `super_admin`, e alterações do próprio
papel são recusadas. A autorização declarativa por entidade e módulo permanece
inalterada.

### Status de completions

A fonte de verdade funcional é o schema Supabase e a UI: os estados são
`aguardando_validacao`, `validada` e `rejeitada`. Escritas AWS usam somente esses
valores. Na leitura, os aliases AWS antigos `validado` e `rejeitado` são
convertidos para a nomenclatura do produto.

O repository replica as invariantes do trigger relacional: cria a conclusão em
espera quando a obrigação exige validação, ou validada quando o executor é admin;
impede auto-validação; somente o validador designado aprova/rejeita; somente o
executor reenvia; e carimba identidades e timestamps no servidor. `rejected_at`
é mantido como campo de compatibilidade usado pela ordenação AWS da UI, enquanto
`validated_at` continua sendo o instante auditável comum à aprovação/rejeição.

## Workspaces e concorrência

O schema e a tela confirmam `access_status = trial`, `trial_ends_at` e os estados
`full`/`suspended`; `restricted` não existe no produto atual e foi removido do
contrato AWS. Um workspace em trial exige a data final. Isso prepara o contrato,
sem conectar nem modificar ainda o CRUD global Supabase-only.

Updates exigem `version`, fazem leitura consistente e usam condição transacional
no DynamoDB. O adapter AWS do frontend memoriza a versão retornada por list/get e
a inclui automaticamente; quando ainda não conhece o registro, faz um get antes
do patch. Locks únicos de completion e audit log continuam na mesma transação.

## Cobertura negativa

Os testes recusam campos desconhecidos e `workspace_id` fornecido pelo cliente,
relações existentes apenas em outro workspace, escalada para `super_admin`,
conclusão em nome de terceiro, status desconhecido, rejeição sem motivo e trial
sem validade. Esses casos verificam que compatibilidade não significa validação
permissiva.
