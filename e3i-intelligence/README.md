# E3I Intelligence

Fundação isolada para discovery, mapeamento, enriquecimento humano, Data Science, Machine Learning, agentes e mensuração de savings.

## Regra de compatibilidade

Esta pasta não é dependência de nenhuma ferramenta operacional existente. Portal, autenticação, SSO, Painel de Obrigações, CRUDs e demais ferramentas devem continuar operando mesmo quando o E3I Intelligence estiver desabilitado ou indisponível.

Na Sprint 1:

- `E3I_INTELLIGENCE_ENABLED` nasce desligado;
- não existe integração de escrita nas ferramentas atuais;
- não existe agente com permissão de alteração;
- a ingestão nasce desabilitada;
- nenhuma tabela ou endpoint atual é modificado;
- o workflow desta pasta apenas valida; não faz deploy.

## Três formas de iniciar um mapeamento

1. **Ferramentas E3I** — dados autorizados podem ser ingeridos futuramente em shadow mode.
2. **Complementação humana** — usuários complementam contexto, tempos, volumes, custos, riscos e evidências.
3. **Do zero** — um `Mapping` pode nascer sem integração prévia e ser enriquecido posteriormente.

Todos os dados carregam proveniência. Informação medida, declarada, extraída, calculada, prevista ou inferida nunca deve ser apresentada como se tivesse a mesma natureza.

## Contratos v1

- `contracts/data-provenance-v1.schema.json`
- `contracts/evidence-v1.schema.json`
- `contracts/event-v1.schema.json`
- `contracts/mapping-v1.schema.json`
- `contracts/saving-opportunity-v1.schema.json`

## Infraestrutura planejada

`foundation-manifest.json` descreve a stack futura de forma não executável e explicitamente sem deploy automático:

- EventBus dedicado;
- fila e DLQ;
- Event Ledger;
- Mapping Store;
- Savings Ledger;
- Audit Store;
- armazenamento privado de evidências;
- endpoint somente de health.

Nenhum desses componentes está conectado às ferramentas atuais nesta Sprint.

## Segurança e LGPD

Consulte `docs/SECURITY-LGPD.md`. Os princípios obrigatórios são isolamento por tenant, minimização, finalidade registrada, proveniência, classificação, retenção, auditabilidade, segregação de funções e proibição de uso de conteúdo de clientes para treinamento de modelos por padrão.

## Validação local

```bash
cd e3i-intelligence
npm test
```

## Próxima etapa

Após revisão e validação desta fundação, a próxima PR deve implementar o Mapping Core autenticado e tenant-scoped em infraestrutura isolada. Só depois conectaremos o primeiro evento de uma ferramenta existente em shadow mode, com falha de telemetria incapaz de afetar a operação principal.
