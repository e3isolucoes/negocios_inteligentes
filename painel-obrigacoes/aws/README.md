# Backend AWS — Painel de Obrigações

Esta pasta contém a transição governada do banco Supabase/PostgreSQL para DynamoDB e dos comprovantes para S3. O Supabase Auth permanece temporariamente como provedor de identidade; o navegador nunca recebe credenciais AWS e não acessa o DynamoDB diretamente.

## Notificações AWS

O template provisiona uma Lambda dedicada que lê atividades, conclusões,
feriados, ajustes de data e perfis diretamente do DynamoDB. O Amazon SES envia
um resumo individual aos responsáveis e um resumo por workspace/módulo a admins
e gestores. O EventBridge Scheduler executa às 08h30 em
`America/Sao_Paulo`, de segunda a sexta-feira.

O agendamento nasce `DISABLED`. Antes de habilitá-lo:

1. implante a identidade SES de `e3isolucoes.com.br`;
2. publique no DNS os três CNAMEs DKIM retornados nos outputs da stack;
3. confirme `VerifiedForSendingStatus=true` no SES;
4. solicite saída do sandbox do SES para destinatários não verificados;
5. invoque a Lambda manualmente com destinatários controlados e revise logs;
6. atualize `NotificationScheduleState=ENABLED` somente após o aceite.

O reset de senha continua no Supabase Auth até a migração separada para Amazon
Cognito. Isso evita invalidar sessões ou bloquear usuários durante o corte do
plano de dados e das notificações.

## Exclusão confiável de comprovantes

`DELETE` responde `202` depois que uma transação marca o registro como
`deletion_pending` e grava o evento outbox. Um EventBridge Pipe entrega os novos
eventos do DynamoDB Streams à fila SQS; a Lambda remove o objeto S3 e somente
então finaliza registro, lock, outbox e auditoria em uma transação idempotente.
A fila tenta cinco vezes antes da DLQ. Alarmes cobrem tentativas repetidamente
falhas e mensagens definitivas na DLQ.

A reconciliação diária percorre a tabela e o bucket, emite métricas
`PendingDeletion`, `ReconciliationFailure`, `OrphanedObject` e
`MissingReferencedObject`, tenta novamente cada outbox pendente e registra as
chaves divergentes em JSON nos logs. Objetos órfãos são apenas reportados (não
apagados automaticamente), para que retenção e investigação sejam aplicadas
antes de uma remoção destrutiva; outboxes pendentes permanecem duráveis e podem
ser reenviadas da stream/DLQ após a correção operacional.

## Fronteiras de isolamento

- Uma stack, tabela e bucket por ferramenta e ambiente (`dev`, `staging`, `prod`).
- Partição operacional por empresa: `TOOL#<tool>#ENV#<env>#WORKSPACE#<id>`.
- Associação de acesso independente por usuário e ferramenta: `TOOL#<tool>#ENV#<env>#USER#<sub>` + `MEMBERSHIP#<workspace>`.
- O cabeçalho `x-workspace-id` apenas seleciona uma associação já concedida; nunca concede acesso.
- Arquivos: `<tool>/<env>/<workspace>/obligations/...`, bucket privado e URL assinada por cinco minutos.
- Toda alteração de dados gera auditoria na mesma transação DynamoDB.

## Fluxo seguro de implantação

### GitHub Actions

O push em `main` que altera `aws/**` aciona o workflow `AWS SAM Staging`.
Antes de publicar em staging, ele valida testes, governança e o template SAM antes de assumir a função
`e3i-staging-deployer` por OIDC. Não existem access keys AWS no GitHub.

Pré-requisitos:

1. provedor IAM `token.actions.githubusercontent.com`, audiência `sts.amazonaws.com`;
2. trust da função limitado ao subject
   `repo:e3isolucoes/portal-e3i-solucoes:environment:aws-staging`, validado
   também pelos IDs imutáveis da organização e do repositório;
3. ambiente GitHub `aws-staging` limitado à branch `main`;
4. variável do repositório `AWS_STAGING_DEPLOY_ROLE_ARN` com a ARN da função;
5. agendamento de notificações mantido `DISABLED` até a validação do SES.

### Conectar o repositório à conta AWS

Execute o bootstrap com uma sessão administrativa temporária. O template cria a
role de menor privilégio usada pelo GitHub e contém as permissões necessárias
para os recursos atuais da stack, incluindo DynamoDB/TTL, Lambda e event source
mappings, SQS, EventBridge Pipes, Scheduler, Cognito, S3, API Gateway, SES e as
roles geradas pelo SAM. Ele não cria access keys.

Se o provedor OIDC do GitHub ainda não existir na conta, crie-o antes com URL
`https://token.actions.githubusercontent.com` e audiência `sts.amazonaws.com`.
Em uma conta nova, o bootstrap pode criar `e3i-staging-deployer` normalmente:

```bash
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
aws cloudformation deploy \
  --stack-name e3i-github-staging-deployer \
  --template-file aws/bootstrap/deployer.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides AccountId="$ACCOUNT_ID"

ROLE_ARN="$(aws cloudformation describe-stacks \
  --stack-name e3i-github-staging-deployer \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" \
  --output text)"
gh variable set AWS_STAGING_DEPLOY_ROLE_ARN \
  --repo e3isolucoes/portal-e3i-solucoes \
  --env aws-staging \
  --body "$ROLE_ARN"
```

Se `e3i-staging-deployer` já existir fora do stack de bootstrap, o
CloudFormation não consegue adotá-la automaticamente. Nesse caso use o script de
conexão com a reutilização explícita da role existente; o script valida que a ARN
pertence à conta autenticada e evita tentar criar uma role duplicada:

```bash
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
AWS_EXISTING_DEPLOY_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/e3i-staging-deployer" \
AZURE_RESOURCE_GROUP="<resource-group>" \
AZURE_STATIC_WEB_APP="<static-web-app>" \
  ./scripts/connect-github-clouds.sh
```

A reutilização explícita não altera silenciosamente a trust policy ou a policy
da role preexistente. Elas devem permanecer sincronizadas com
`aws/bootstrap/deployer.yaml`; isso evita que um bootstrap automatizado amplie
ou substitua permissões de uma role que não é gerenciada pelo stack.

Cadastre também `PORTAL_PROVISIONING_SECRET` como **environment secret** de
`aws-staging`; nunca o grave em arquivo ou como variável não secreta. Depois,
execute manualmente `AWS SAM Staging` no GitHub e confira no resumo do job a
stack, a região, a URL da API e o commit implantado. O subject OIDC do template
restringe a sessão ao repositório e ao ambiente esperados.

O deploy usa `cancel-in-progress: false` para nunca interromper uma atualização
CloudFormation em andamento. Produção permanece fora deste workflow e exige um
ambiente, função IAM e aprovação separados.

1. Instale AWS SAM CLI e autentique a AWS CLI em uma conta sem credenciais compartilhadas.
2. Em `aws/api`, execute `npm ci`; em `aws/migration`, execute `npm ci`.
3. Valide: `sam validate --lint --template-file aws/template.yaml`.
4. Implante primeiro em `staging` com `sam deploy --guided --template-file aws/template.yaml`.

## Migração de autenticação

O stack cria um User Pool Cognito com recuperação por e-mail via SES. Depois do
deploy, execute `migrate-cognito-users.mjs` com `DYNAMODB_TABLE` e
`COGNITO_USER_POOL_ID`. A migração preserva o UUID legado no atributo
`custom:legacy_user_id`; senhas do Supabase não são copiadas. Cada pessoa deve
usar **Esqueci minha senha** para definir uma senha nova na AWS.

O agendamento de notificações deve permanecer `DISABLED` enquanto a conta SES
estiver no sandbox. Ative-o somente após `ProductionAccessEnabled=true` e um
envio controlado bem-sucedido.
5. Defina as variáveis da migração somente no terminal/secret store; nunca em arquivo versionado.
6. Rode `npm run plan`, revise contagens, faça backup lógico do Supabase e só então `npm run migrate`.
7. Rode `npm run reconcile`. Diferença de contagem impede o corte.
8. Faça testes de isolamento com dois usuários de empresas diferentes e testes de função (`member`, `manager`, `admin`).
9. Ative o novo backend no frontend por configuração, acompanhe erros e mantenha Supabase em leitura durante a janela de reversão.
10. Defina `FILES_BUCKET`, execute `npm run migrate:files` e confira o relatório de cópia/hash antes de desativar o Storage antigo.

O modo provisionado começa em 1 RCU/1 WCU e um GSI esparso em 1/1, abaixo da franquia tradicional. Não habilite PITR ou KMS gerenciado sem revisar custo; a retenção inicial usa `DeletionPolicy: Retain`, versionamento S3 e exportação lógica antes do corte.

No staging atual, o transformador SAM não propagou `DefaultRouteSettings` para o stage `$default`. O deploy aplica `ThrottlingRateLimit=2` e `ThrottlingBurstLimit=5` diretamente após o stack e deve verificar esses valores em todo release até o stage ser modelado por um recurso CloudFormation explícito.

A tabela principal usa capacidade provisionada governada em `20 RCU / 5 WCU`, com o GSI em `1/1`. Os parâmetros do template impedem ultrapassar esses tetos sem uma alteração revisada de infraestrutura. Essa margem suporta a leitura do conjunto atual de obrigações e mantém a soma provisionada abaixo da franquia gratuita aplicável à conta, desde que não existam outros consumos concorrentes da mesma franquia.

## Variáveis da migração

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DYNAMODB_TABLE`, `AWS_REGION`, `TOOL_ID` e `APP_ENV`. A `service_role` é secreta e deve ser rotacionada após a migração.

## Alertas após o cutover

Foi escolhida a opção **EventBridge Scheduler + Lambda dedicada**. Ela elimina o
job agendado e seus segredos no GitHub, usa a role efêmera da própria Lambda e
reduz a operação a recursos observáveis no mesmo stack. A Lambda consulta cada
partição de workspace separadamente, pagina todas as respostas e envia com SES;
assim não há chave da Resend nem credencial AWS estática. Uma migração para
Resend aqui adicionaria um segredo server-side sem benefício operacional.

O agendamento nasce `DISABLED` para permitir o cutover governado e deve ser
habilitado somente depois da validação manual descrita acima. Entregas têm um
registro diário por destinatário (hash, sem e-mail) para deduplicar retries.
O runner legado local de alertas Supabase já foi removido do repositório; a
notificação suportada é a Lambda AWS versionada nesta pasta.
