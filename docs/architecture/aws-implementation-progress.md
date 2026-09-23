# Progresso da implementação AWS governada

Data do diagnóstico: 30/08/2026

## Estado confirmado

- Frontend estático hospedável no Azure Static Web Apps.
- Backend AWS modelado em SAM com Lambda arm64, API Gateway HTTP, DynamoDB e S3.
- Tabela e bucket separados por ambiente e ferramenta.
- Particionamento inclui ferramenta, ambiente e workspace.
- Associação de usuário é consultada no DynamoDB antes de aceitar a empresa solicitada.
- Migração e reconciliação Supabase/AWS possuem scripts e testes.
- Frontend possui adaptadores AWS para a maior parte das entidades, mas AWS ainda é preview opt-in.
- Produção continua no Supabase e não deve sofrer corte automático.

## Incremento implementado

- Validação de JWT do Portal E3I por JWKS, `RS256`/`ES256`, emissor, audiência e `tool_id`.
- Compatibilidade Supabase explicitamente desligável após o cutover.
- Tokens para outra ferramenta são rejeitados.
- Paginação DynamoDB com cursor opaco e limite máximo de 100 registros.
- Cliente percorre páginas e preserva compatibilidade com a resposta anterior de staging.
- Atualização utiliza versão otimista e retorna conflito em gravação concorrente.
- Corpo HTTP limitado a 32 KiB e respostas com headers defensivos.
- Bucket rejeita HTTP, Lambda limita concorrência e logs têm retenção menor fora de produção.
- Orçamento padrão de US$ 3, com alertas reais de 50%, 80% e 100% e previsão de 100%.
- Catálogo fechado de módulos com contratos de `render`, `mount`, permissão e ordem.
- Feature flags por ambiente e `module_grants` opcionais com negação por padrão quando configurados.
- Módulos não carregam código remoto nem recebem acesso direto a segredos ou clientes AWS.

## Bloqueios para o corte

1. O Portal E3I precisa expor um JWKS estável e emitir tokens curtos com `kid`.
2. O frontend ainda inicia sua sessão pelo Supabase; o provedor `E3I_AUTH` foi preparado, mas precisa ser conectado ao fluxo real do portal.
3. Operações em lote ainda declaradas como indisponíveis no adaptador AWS precisam de endpoints transacionais.
4. SAM CLI não está instalado neste host; `sam validate --lint` deve passar no CI antes do deploy.
5. Reconciliação final, restauração, dois tenants e revogação ainda precisam de evidência em staging.
6. O modo de produção ainda escolhe Supabase e isso deve permanecer até a aprovação do cutover.

## Rollback

Enquanto o corte não for aprovado, nenhuma reversão é necessária: Supabase
permanece como backend padrão. Durante a janela futura, reverta a configuração
do frontend, preserve o delta DynamoDB, reconcilie-o e não sobrescreva a origem.
