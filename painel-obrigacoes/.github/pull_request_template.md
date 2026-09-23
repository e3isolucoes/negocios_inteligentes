## Objetivo

Descreva a mudança e o problema resolvido.

## Risco e dados

- [ ] Não altera autenticação, RLS, permissões ou isolamento entre empresas.
- [ ] Não adiciona segredo, dado pessoal, fiscal ou backup ao repositório.
- [ ] Migrações SQL são aditivas e possuem estratégia de reversão.

## Validação

- [ ] `npm ci --ignore-scripts`
- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run governance`
- [ ] Teste manual no ambiente de preview

## Publicação e reversão

Informe como validar em produção e qual commit deve ser restaurado em caso de falha.
