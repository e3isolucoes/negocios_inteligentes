# Relatório de implementação — AI Foundation 01

Data: 2026-08-16. Este relatório **não declara Quality Gate aprovado**.

## Entrega

- Criados módulos em `src/ai`: core, context, models, prompts, skills, tools, security, observability, schemas, errors, retrieval, agents e operação.
- Modificados `package.json` para expor os checks solicitados. Nenhuma rota ou tela foi alterada.
- Operação migrada/demonstrada: `discovery.extract-business-context`, acessível somente pelo Harness, com `FACT` e output estruturado.
- Prompt registrado: `discovery.extract-business-context@1` (ACTIVE).
- Skill registrada: `business-context-extraction@1` (ACTIVE).
- Tool exercitada: definição read-only `read-context`, apenas em teste de registry; nenhuma execução autônoma.

## Uso direto de modelo restante

`api/checklist-suggestions.js` contém integração OpenAI preexistente e não pertence à nova operação. Ela permanece dívida legada e deve ser migrada após existir autenticação/TenantContext nessa Azure Function. Não existe uso direto de Gemini fora de `src/ai/models/`.

## Testes executados

- `npm run typecheck`: passou (`node --check` nos entrypoints).
- `npm run test:unit`: passou, 4/4 testes.
- `npm run test:integration`: passou, 1/1 teste, sem rede/Gemini real.
- `npm run test:frontend`: passou, 78/78 testes.
- `npm run build`: passou; o projeto informa que nenhum build é necessário para o site estático.

## Débitos técnicos

- O repositório é JavaScript ESM/site estático, sem TypeScript ou SDK Gemini previamente instalado; a camada foi adaptada para `.js` com contratos JSDoc.
- A instalação de `zod` e `@google/genai` retornou HTTP 403 pela política do registry. O contrato usa a API `safeParse`, compatível com schemas Zod, com validadores explícitos nesta operação. Deve-se trocar o schema local por Zod assim que a dependência aprovada estiver disponível.
- `GeminiProvider` usa a API REST oficial por não haver SDK no projeto; migrar internamente para o SDK não altera Harness/domínio.
- O site ainda não possui backend tenant autenticado para expor a nova operação; por segurança, nenhuma rota anônima foi criada.
- `AITrace` usa sink injetável; persistência durável depende de storage/auditoria futura.
