# ADR-AI-001 — Acesso a LLM exclusivamente pelo AI Harness

- **Status:** Aceita
- **Data:** 2026-08-16

## Contexto

Chamadas diretas de módulos de negócio acoplam provider, espalham prompts, dificultam isolamento tenant, validação, budgets, auditoria e fallback seguro.

## Decisão

Novas operações de negócio não podem acessar LLMs ou SDKs diretamente. Elas chamam um use case que entrega um TenantContext backend-validado e um AIRequest ao `AIHarness`. Somente `src/ai/models/` conhece protocolos de provider. Prompt, skill, contexto, policy, routing, output e trace são aplicados centralmente.

## Consequências

Há uma fronteira testável com dependency injection, troca futura de provider e enforcement consistente. Toda operação exige registro explícito, schema e budget. Isso adiciona configuração inicial e impede experimentos que contornem governança. A rota legada de sugestões deve ser migrada separadamente antes de ser considerada aderente.

## Alternativas rejeitadas

- Chamadas diretas em rotas: acoplamento e controles inconsistentes.
- Um wrapper somente de SDK: não cobre tenant, contexto, policy e evidência.
- Roteador baseado em LLM: custo e decisão não determinística desnecessários.
- Mock como fallback produtivo: produz falsa IA e mascara indisponibilidade.
