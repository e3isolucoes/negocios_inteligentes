# AI Foundation 01

## Princípios e fluxo

O Harness aplica a ordem **regras → contexto autorizado → retrieval → algoritmos determinísticos → modelo pequeno → modelo potente**. Modelos são usados apenas quando linguagem é necessária. O desenho é evidence-first, multi-tenant, least-privilege e não atribui métricas ausentes.

```text
Use case -> AIHarness -> TenantContext -> ContextCompiler -> AIPolicyEngine
         -> PromptRegistry + SkillRegistry -> ModelRouter -> ModelGateway
         -> GeminiProvider -> validação estruturada -> AITrace -> aplicação
                                |
                       nenhum fallback para Mock
```

`AIHarness.execute` é a entrada oficial. O contexto vem de fontes autorizadas da organização validada; o `organizationId` de payload, quando presente, apenas pode coincidir com o TenantContext. `ContextCompiler` filtra tenant e segredos, seleciona requirements e aplica limites antes de ordenar por autorização, relevância, confiança, recência e tamanho. Documentos recuperados permanecem conteúdo externo não confiável, nunca instruções.

## Registries, gateway e segurança

Prompts ativos são versionados e resolvidos pelo `PromptRegistry`. A primeira definição é `discovery.extract-business-context@1`; a skill ativa `business-context-extraction` proíbe transformar inferências em fatos. Uma futura pasta `skills/<nome>/SKILL.md` poderá ser adaptada para `SkillDefinition` sem mudar domínio ou Harness.

`ModelRouter` é determinístico (`NO_MODEL`, `FAST`, `BALANCED`, `REASONING`) e recebe nomes por ambiente. `ModelProvider`/`ModelGateway` isolam o provedor. Apenas Gemini é implementado; as interfaces, e não provedores fictícios, permitem extensões. O `ToolRegistry` descreve ferramentas internas read-only e não as executa. Tools não dependem de Gemini.

Input guard, allowlist de contexto e policy são controles independentes de prompts. Conteúdo não concede permissão, troca tenant/modelo/credencial nem habilita tools. O nível máximo é `RECOMMEND`; não há mutação externa. Outputs JSON passam por `safeParse` do contrato antes do domínio. Em instalação com Zod, schemas Zod atendem diretamente este contrato; a dependência não foi adicionada porque o registry do ambiente recusou o download (ver relatório).

## Observabilidade, evidência e falhas

Trace contém apenas metadados, identidade tenant, versões, tempos, status e contadores retornados pelo provedor. Conteúdo integral e segredos não são registrados. Contadores e custo desconhecidos são `null`. A extração retorna `sourceIds` e `FACT`, sem confidence inventada. Indisponibilidade do Gemini gera erro tipado e trace; não troca para Mock nem cria conteúdo.

`AI_FEATURES_ENABLED=false` (default) impede chamadas de IA sem afetar o site estático. Mock é somente test double injetado; `AI_PROVIDER=mock` fora de `NODE_ENV=test` impede configuração.

## Extension points (não implementados)

`KnowledgeRetriever` exige `organizationId` em cada consulta e resultado, preparando RAG sem vector database. MCP poderá seguir `adapter -> ToolRegistry -> policy -> use case`. Contratos passivos preparam `AgentRun`, `AgentStep`, `ToolCall` e `ApprovalRequest`, sem loop ou autonomia. A2A, AG-UI, A2UI e Agent Plugins são possíveis adaptadores futuros. UCP e AP2 estão fora do escopo. Nenhum MCP, RAG agentic ou protocolo foi implementado.
