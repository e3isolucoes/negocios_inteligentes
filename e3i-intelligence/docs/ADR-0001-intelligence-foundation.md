# ADR-0001 — Fundação isolada do E3I Intelligence

- Status: Proposed
- Data: 2026-09-15
- Escopo: Sprint 1

## Contexto

O E3I Intelligence deve evoluir o Portal com mapeamento, enriquecimento humano, Data Science, Machine Learning, agentes e mensuração de savings sem se tornar dependência das ferramentas operacionais atuais.

Também deve permitir três origens de contexto: dados vindos de ferramentas E3I, complementação manual e mapeamentos iniciados do zero.

## Decisão

O E3I Intelligence será uma bounded context e uma stack separada.

As ferramentas existentes não consultarão o Intelligence para concluir operações de negócio. Integrações futuras serão assíncronas e best-effort. Falha de telemetria não poderá alterar o status HTTP ou a transação principal de uma ferramenta.

A Sprint 1 entrega somente fundação, contratos e infraestrutura isolada. O barramento nasce desabilitado e não haverá deploy automático.

## Contratos centrais

- `Event`: fato imutável de uma ferramenta ou do próprio Intelligence.
- `DataProvenance`: origem, natureza, classificação, finalidade e retenção de um dado.
- `Evidence`: referência íntegra a evidência, sem conteúdo bruto dentro do contrato.
- `Mapping`: contexto de processo, área ou oportunidade que pode nascer do zero e receber múltiplas fontes.
- `SavingOpportunity`: hipótese ou resultado de saving com baseline, evidências, confiança e estado de validação.

## Compatibilidade

```text
Intelligence OFF          -> ferramentas atuais continuam funcionando
Intelligence indisponível -> ferramentas atuais continuam funcionando
Fila indisponível         -> operação principal não é revertida
ML indisponível           -> apenas score ou recomendação deixa de existir
Agente indisponível       -> nenhuma operação transacional é bloqueada
```

## Segurança

- tenant obrigatório em todo dado de negócio;
- APIs futuras autorizam no backend, nunca somente no frontend;
- eventos não carregam segredos de autenticação;
- evidências são armazenadas por referência privada;
- dados pessoais são classificados e vinculados a finalidade;
- resultados previstos ou inferidos permanecem identificados como tal;
- conteúdo de clientes não será usado como conjunto de treinamento por padrão;
- ações de agentes começarão read-only e obedecerão à interseção entre RBAC do usuário, permissão da ferramenta e policy engine.

## Consequências

### Positivas

- baixo risco de regressão;
- rollback simples;
- evolução independente;
- auditoria e proveniência desde o início;
- suporte a clientes já digitalizados e clientes que começam do zero.

### Custos

- mais componentes de infraestrutura;
- necessidade de governança de contratos;
- eventual consistência entre ferramenta e Intelligence;
- necessidade de observabilidade e DLQ para integrações futuras.

## Fora do escopo desta Sprint

- alteração no Portal;
- alteração no Painel de Obrigações;
- ML em produção;
- agentes com escrita;
- embeddings de dados de clientes;
- importação automática de documentos;
- deploy automático da stack.
