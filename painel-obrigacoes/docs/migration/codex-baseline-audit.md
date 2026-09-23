# Auditoria baseline — migração Supabase → AWS

**Data da evidência:** 09/09/2026  
**Escopo:** `painel-obrigacoes`, frontend no Azure Static Web Apps (SWA), Azure
Functions, automações, data plane AWS e ferramentas de migração.  
**Método:** inspeção read-only anterior a esta publicação; a única alteração feita
foi este relatório. Não houve mudança funcional, de `js/runtime-config.js`, de
credenciais ou deploy.

## Resumo executivo

O repositório contém um data plane AWS substancial (Cognito, API Gateway/Lambda,
DynamoDB, S3, SES e jobs), mas **o corte não está pronto para produção**. O
`runtime-config.js` hoje escolhe AWS/Cognito por padrão e permite rollback público
por `?backend=supabase` (`js/runtime-config.js:17-29`), enquanto documentos de
governança ainda afirmam que produção permanece no Supabase
(`docs/architecture/aws-implementation-progress.md:13-14,31-38` e
`docs/governance/aws-cutover-runbook.md:5-9`). Esse drift é P0.

Há bloqueios funcionais objetivos: gestão de workspaces e convite de usuários são
Supabase-only (`js/api/workspaces.js:3-18`, `js/api/adminUsers.js:23-33`), a Azure
Function de sugestões valida somente token Supabase
(`api/checklist-suggestions.js:18-30`), importação de obrigações e atribuição em
lote de validadores recusam AWS (`js/api/obligations.js:38-48`,
`js/api/validation.js:130-135`), e o relatório de desempenho continua numa view
Supabase (`js/api/validation.js:160-164`). Além disso, payloads reais são rejeitados
pelo validador AWS: `module_key`, estados femininos `validada/rejeitada`,
`rejected_at`, `trial` e `trial_ends_at`.

## Arquitetura atual observada

```text
Browser estático (Azure SWA)
  ├─ runtime-config: AWS/Cognito por padrão; ?backend=supabase = fallback
  ├─ módulos js/api/* com branches AWS e Supabase
  ├─ Supabase Auth/PostgREST/Storage ainda alcançáveis
  ├─ AWS HTTP API → Lambda → DynamoDB (single-table) / S3 / Cognito
  └─ /api/checklist-suggestions → Azure Function → Supabase Auth → OpenAI/fallback

GitHub Actions
  ├─ deploy Azure SWA (ainda recebe configuração Supabase)
  ├─ deploy SAM staging
  └─ alerta legado → Supabase service role + Resend

AWS Scheduler → Lambda notifications → DynamoDB scan + SES
DynamoDB Streams → EventBridge Pipe → SQS → worker de exclusão S3
```

Evidência de infraestrutura: `aws/template.yaml` define Cognito, tabela DynamoDB,
bucket S3, API Lambda, fila/worker/reconciliador de exclusões, SES e agendamento.
O bucket é privado, criptografado, versionado e retém versões não correntes por 90
dias (`aws/template.yaml:281-308`). A API usa uma única tabela por ferramenta e
ambiente, com `PK/SK` e `GSI1` (`aws/template.yaml:239-280`).

## Inventário de dependências e superfícies

| Superfície | Dependências/runtime | Lock verificável | Observação |
|---|---|---|---|
| frontend + alertas | JS estático; `@supabase/supabase-js` | `package-lock.json` | SDK ainda ativo no browser e job legado (`package.json:13-15`) |
| Azure Function | `@azure/functions` | `api/package-lock.json` | autenticação Supabase e chamada OpenAI (`api/checklist-suggestions.js:1,18-30,129-137`) |
| AWS API | AWS SDK Cognito/DynamoDB/S3/SES, `jose`, `esbuild` | **somente `pnpm-lock.yaml`** | não instalado, pois a instrução restringiu instalação aos `package-lock` existentes |
| AWS migration | AWS SDK Cognito/DynamoDB/S3 | **somente `pnpm-lock.yaml`** | mesma limitação |
| IaC | AWS SAM/CloudFormation | n/a | SAM CLI ausente neste host |
| CI/CD | GitHub Actions, Azure SWA action, SAM | n/a | workflows raiz e duplicata parcial sob `painel-obrigacoes/.github` |

Foram usados apenas `npm ci --ignore-scripts` no pacote raiz e em `api/`; não
houve upgrade ou geração de lockfile.

## 1. Referências ativas a Supabase

### Frontend

- bootstrap/configuração: `js/config.js:1-6`, `js/supabaseClient.js:1-18`,
  `js/app.js:1,63-70,115-119` e o fallback de runtime
  `js/runtime-config.js:17-29`;
- autenticação: `js/api/auth.js:1-2,38-53,76-116,150-176`; mesmo sob Cognito há
  compatibilidade de sessão Portal Supabase (`portalSupabaseSession`);
- endpoint de sugestões: `js/checklistSuggestions.js:2,63-81` obtém token por
  `supabase.auth.getSession()`;
- acesso a dados com fallback Supabase: `categories.js`, `profiles.js`,
  `obligationRules.js`, `completions.js`, `auditLog.js`, `obligations.js`,
  `validation.js`, `occurrenceOverrides.js`, `taxRegimes.js`, `checklist.js`,
  `comments.js`, `companies.js`, `holidays.js` e `storage.js` sob `js/api/`;
- exclusivamente Supabase: `js/api/adminUsers.js:23-33`,
  `js/api/workspaces.js:3-18` e a implementação duplicada legada
  `js/api/categorias.js:34-104`;
- `workspaceContext.js` depende de estado, não de chamada remota; `portalAuth.js`
  é transporte Portal, portanto os nomes “Supabase-only” obtidos por simples falta
  de branch não devem ser interpretados como acesso Supabase.

### Azure Functions, scripts e workflows

- `api/checklist-suggestions.js:18-30` chama `/auth/v1/user` com
  `SUPABASE_URL`/`SUPABASE_ANON_KEY`; não aceita Cognito;
- `scripts/enviar-alertas.mjs:1-12,196-238` cria cliente com service role, lê
  `obligations`, `completions`, `profiles`, `holidays` e envia via Resend;
- `.github/workflows/alertas-diarios.yml:30-48` exige secrets Supabase e executa o
  job legado; existe duplicata em `painel-obrigacoes/.github/workflows/`;
- `.github/workflows/azure-static-web-apps.yml:48-49,80-81` e workflows de staging
  e regressão ainda injetam/validam Supabase;
- scripts de migração leem Supabase por REST/service role
  (`aws/migration/shared.mjs:11-27`) e Storage autenticado
  (`aws/migration/migrate-files.mjs:21-32`), uso esperado apenas na janela.

## 2. Referências ativas a Vercel

Não foi encontrada referência Vercel em código, configuração, script ou workflow
mantido pelo projeto. A única ocorrência local estava em código distribuído dentro
de `node_modules/@supabase/*` (detecção genérica de “Vercel Edge”), excluído do
inventário por ser dependência gerada e não uma integração ativa.

## 3. Matriz Funcionalidade × Supabase × AWS

Legenda: **sim** = implementado; **parcial** = semântica divergente/loop cliente;
**não** = ausente ou bloqueado explicitamente.

| Funcionalidade/módulo | Supabase | AWS | Evidência / conclusão |
|---|---:|---:|---|
| empresas | sim | sim | `js/api/companies.js:5-61` |
| obrigações CRUD | sim | sim, incompatível | `module_key` enviado em `js/data.js:357-381`, mas ausente em `validators.mjs:23-31` |
| importação obrigações em lote | RPC + insert | não | erro explícito `js/api/obligations.js:38-48` |
| conclusões | sim | sim, incompatível na validação | `js/api/completions.js:5-69`; status abaixo |
| comentários | sim | sim | `js/api/comments.js:5-34` |
| checklist | RPC/batch | parcial | AWS faz N requests; `js/api/checklist.js:35-81` |
| feriados | sim | sim | `js/api/holidays.js:5-26` |
| regras de obrigação | sim | sim | `js/api/obligationRules.js:5-29` |
| overrides de data | sim | sim | `js/api/occurrenceOverrides.js:5-40` |
| regimes/regras tributárias | sim | sim/parcial | N creates/deletes AWS; `js/api/taxRegimes.js:34-60` |
| categorias CRUD/ordenação | sim | sim/parcial | ordenação é N PATCH; `js/api/categories.js:109-114` |
| reclassificação de categoria | RPC atômica | não | AWS lança erro; `js/api/categories.js:87-101` |
| validação individual | sim | **quebrada** | frontend envia feminino e `rejected_at`; validator aceita masculino e não aceita `rejected_at` |
| atribuição em lote de validadores | RPC | não | `js/api/validation.js:129-135` |
| relatório de desempenho | view | não | `js/api/validation.js:160-164` sem branch AWS |
| perfis | sim | sim | `js/api/profiles.js:5-17` |
| convite/criação de usuário | sign-up browser | não conectado | `js/api/adminUsers.js:23-33`; Cognito AdminCreateUser existe no backend, mas o frontend não o usa |
| workspaces / trial | sim | não no frontend; contrato incompleto | `js/api/workspaces.js:3-18`; validator `workspaces` não aceita `trial` nem `trial_ends_at` |
| audit log | sim | leitura sim | `js/api/auditLog.js:4-13`; escrita da API é interna |
| anexos | Storage | S3 | `js/api/storage.js:8-33` |
| sugestões checklist | Supabase Auth | não Cognito | `js/checklistSuggestions.js:63-81`; `api/checklist-suggestions.js:18-30` |
| alertas | Supabase + Resend | DynamoDB + SES | ambos ativos/configurados; risco de duplicidade |

## 4–6. Dados, tabelas e Storage

### Matriz Tabela/Storage × origem × destino × reconciliador

O catálogo migrado é fechado em `aws/migration/shared.mjs:4-9`.

| Origem Supabase | Destino DynamoDB/S3 | Transformação | Reconciliação |
|---|---|---|---|
| `workspaces` | `WORKSPACE_META#id` na partição do workspace | workspace usa seu próprio `id` como tenant | contagem por prefixo |
| `profiles` | `PROFILE#id` + `MEMBERSHIP#workspace` por usuário | papéis PT normalizados para EN; super_admin sem workspace vai à partição administrativa | contagem de perfil, membership e admin global |
| `companies` | `COMPANY#id` | cópia de campos | contagem/chaves |
| `obligations` | `OBLIGATION#id` | cópia de campos | contagem/chaves |
| `completions` | `COMPLETION#id` | reescreve `attachment_path` para chave S3 legada | contagem/chaves + verificação de arquivos |
| `obligation_comments` | `COMMENT#id` | cópia | contagem/chaves |
| `audit_log` | `AUDIT#id` | cópia | contagem/chaves |
| `holidays` | `HOLIDAY#id` | cópia | contagem/chaves |
| `checklist_items` | `CHECKLIST#id` | cópia | contagem/chaves |
| `obligation_rules` | `RULE#id` | cópia | contagem/chaves |
| `obligation_date_overrides` | `DATE_OVERRIDE#id` | cópia | contagem/chaves |
| `tax_regimes` | `TAX_REGIME#id` | cópia | contagem/chaves |
| `tax_regime_rules` | `TAX_REGIME_RULE#id/composto` | ID composto se ausente | contagem/chaves |
| `categories` | `CATEGORY#id` | cópia | contagem/chaves |
| bucket `comprovantes` | `e3i-${Environment}-painel-obrigacoes-files-${AccountId}` | `${toolId}/${appEnv}/${workspace_id}/legacy/${sourcePath}` | SHA-256 por `HeadObject` metadata |

Detalhes: `toItem()` exige `workspace_id`, preserva os demais campos e acrescenta
`toolId`, `environment`, `entityType`, `schemaVersion=1`, `migratedAt`
(`aws/migration/shared.mjs:39-64`). `reconcile.mjs:5-35` compara somente contagens;
`verify-coverage.mjs:7-46` compara chaves e reporta missing/extras, mas seu exit code
só considera `sourceMissing`, não extras no destino, e não compara conteúdo de
registros. Portanto não há reconciliação field-by-field/hash dos dados.

### Dados Supabase não cobertos

- `administrative_modules`, criada por
  `sql/migrations/20260826_add_administrative_modules.sql:2-35`, não consta no
  catálogo de migração nem no modelo AWS. `module_access` do perfil é migrado, mas
  o catálogo/metadata administrativa não;
- identidades e credenciais de `auth.users` não são parte do migrador de dados.
  `migrate-cognito-users.mjs:13-42` cria usuários a partir de perfis DynamoDB com
  senha temporária; não migra hash, sessão, MFA, refresh tokens ou estado de
  confirmação equivalente;
- objetos órfãos no bucket `comprovantes` não são descobertos: o migrador enumera
  somente `completions` com `attachment_path` (`migrate-files.mjs:10-21`);
- views e resultados derivados não são materializados: `vw_categorias_uso`,
  `vw_aguardando_validacao`, `vw_rejeitadas`, `vw_meus_envios_pendentes`,
  `vw_sem_validador`, `vw_validacao_desempenho` (`sql/schema.sql:1180-1294`).

### Storage: bucket, paths, metadata e regras

- origem: bucket privado Supabase `comprovantes`; frontend grava
  `${workspaceId}/${obligationId}/${occurrenceDate}/${filename}` e usa upsert
  (`js/api/storage.js:8-24`);
- destino online: `awsData.uploadUrl()` fornece chave e URL presigned; PUT envia
  apenas `Content-Type` (`js/api/storage.js:10-19`);
- destino legado: `${toolId}/${appEnv}/${workspace_id}/legacy/${sourcePath}`
  (`aws/migration/migrate-files.mjs:21-32`);
- metadata legada: `workspace`, `source=supabase`, `sha256`, `completion`; preserva
  `Content-Type`, mas não cache-control, filename original explícito, ETag original,
  timestamps ou metadata customizada (`migrate-files.mjs:28-32`);
- idempotência: `HeadObject` considera qualquer objeto existente como concluído e
  não valida hash nessa etapa; `verify-files.mjs:14-32` deve ser executado depois;
- o bucket S3 bloqueia acesso público, exige TLS, usa SSE-S3/AES256, versionamento,
  aborta multipart após 7 dias e expira versões antigas após 90 dias
  (`aws/template.yaml:281-319`); CORS limita GET/PUT e `content-type`.

## 7. Autenticação, refresh, Portal SSO, memberships e `super_admin`

- Cognito browser session usa access/id token em memória e refresh token em cookie
  HttpOnly emitido pelo backend; refresh/logout passam por `/v1/session/*`
  (`js/api/auth.js:55-75,95-136`; `aws/api/src/browser-session.mjs`).
- Portal SSO tenta troca de código AWS e depois `postMessage`; há compatibilidade
  explícita com tokens Supabase do Portal (`js/api/auth.js:38-53,137-156`,
  `js/portalSession.js`). A Azure Function de IA quebra esse fluxo ao exigir token
  Supabase.
- autorização AWS não confia somente no workspace do request: memberships usam
  `PK=...USER#userId`, `SK=MEMBERSHIP#workspaceId` e são verificadas pelo repository
  (`aws/api/src/model.mjs:28-40`, `aws/api/src/repository.mjs`).
- **Falha de autorização modular:** `profiles.module_access` não é copiado para
  `membership.module_grants` (`aws/migration/shared.mjs:63-65`), mas a API consulta
  somente `module_grants` e trata sua ausência como acesso irrestrito
  (`aws/api/src/auth.mjs:69-83`). Restrições existentes podem ser silenciosamente
  removidas após a migração.
- migração normaliza `membro→member`, `gestor→manager`,
  `administrador→admin` (`aws/migration/shared.mjs:35-37`). Contudo o frontend
  continua produzindo/interpretando mistura de `membro`, `gestor` e `admin`
  (`js/data.js:540-554`), enquanto `validators.mjs:16-18` aceita apenas EN. Perfis
  legados enviados diretamente ao AWS podem ser rejeitados ou perder semântica.
- `super_admin` global sem workspace é copiado para uma partição administrativa e
  reconciliado separadamente (`shared.mjs:39-53`, `reconcile.mjs:31-35`). O backend
  ainda exige membership para dados de tenant: super_admin global não recebe
  automaticamente acesso operacional, uma decisão segura, mas o frontend
  Supabase espera listar/gerir todos os workspaces. O script manual
  `aws/bootstrap/grant-staging-superadmin-membership.ps1` confirma que hoje é
  necessário conceder membership por workspace.

## 8. Jobs agendados e alertas

Dois caminhos coexistem:

1. legado: `.github/workflows/alertas-diarios.yml` agenda
   `scripts/enviar-alertas.mjs`, que lê Supabase com service role e envia Resend;
2. AWS: `NotificationSchedule` executa dias úteis às 08:30 America/Sao_Paulo e a
   Lambda lê DynamoDB/SES (`aws/template.yaml:455-519`,
   `aws/api/src/notifications.mjs`).

Não há exclusão mútua, leader election ou marcador de cutover entre eles. Ativar
o schedule AWS sem desabilitar o workflow legado pode duplicar alertas. O job de
reconciliação de exclusões S3 (`aws/template.yaml:375-396`) não lê Supabase.

## 9. Divergências de payload frontend × `validators.mjs`

| Fluxo | Payload real | Contrato AWS | Impacto |
|---|---|---|---|
| salvar obrigação | inclui `module_key` (`js/data.js:357-381`) | campo ausente (`validators.mjs:23-31`) | create/update retorna 400 “Campo não permitido” |
| validar | `status='validada'` (`js/api/validation.js:90-99`) | enum `validado` (`validators.mjs:37`) | 400 |
| rejeitar | `status='rejeitada'`, `rejected_at`, `validator_id` (`validation.js:104-112`) | enum `rejeitado`; não existe `rejected_at`; existe `validated_by` | 400 e identidade inconsistente |
| contagem/filtros | procura `rejeitada` (`validation.js:52-58`; `data.js:94-97`) | persistência aceita `rejeitado` | filas/contagens zeradas se normalizado só no servidor |
| criar/editar workspace | `access_status='trial'`, `trial_ends_at` (`data.js:112-130`) | enum só `full/restricted/suspended`, sem `trial_ends_at` (`validators.mjs:52`) | impossível implementar branch por CRUD genérico atual |
| mudar papel | UI pode enviar `membro`/`gestor`/`admin` (`data.js:535-554`) | apenas `member/manager/admin/super_admin` (`validators.mjs:16-18`) | 400 para PT |
| conclusão inicial | não envia `done_at` nem `status` (`completions.js:17-33`) | não os exige, embora declare `done_at` timestamp sem nullable | criação aceita; defaults dependem exclusivamente do repository/backend |
| categoria | create omite `sistema` e `exige_validacao` | não obrigatórios | aceita, mas sem paridade garantida com defaults SQL |

## 10. Lotes, RPCs e views sem equivalente AWS

- `import_obligations` — sem endpoint transacional AWS e bloqueio explícito;
- `categoria_reclassificar` — sem equivalente; requer atualização referencial
  atômica e exclusão da categoria de origem;
- `definir_validador_categoria` — sem equivalente em lote;
- `vw_validacao_desempenho` — frontend continua Supabase-only;
- `vw_categorias_uso` tem cálculo AWS no cliente (parcial), e `vw_sem_validador`
  tem filtro AWS no cliente; não são equivalentes em custo/paginação/consistência;
- `set_checklist_item_done` e `reset_checklist_items` viraram PATCH(s) genéricos,
  sem atomicidade da RPC;
- inserts/deletes em lote de checklist, regras de regime e ordenação de categorias
  viraram `Promise.all` de requests independentes, sem rollback;
- triggers Supabase `enforce_completion_attachment`, preparação/auditoria da
  validação, audit log e constraints relacionais precisam de prova equivalente no
  repository AWS; validação de forma não equivale às garantias transacionais SQL.

## 11. Cutover e rollback atuais

Mecanismo executável: `runtime-config.js` define AWS/Cognito como padrão e troca
ambos para Supabase quando a query pública é `?backend=supabase`
(`js/runtime-config.js:17-29`). O runbook, ao contrário, manda alterar a configuração
de produção e afirma que Supabase continua o padrão
(`docs/governance/aws-cutover-runbook.md:21-29,39-45`). Não há flag server-side,
allowlist de operador, rollout por tenant, dual-write, write fence automatizado nem
exportador do delta AWS para rollback. A query pública também permite a qualquer
usuário escolher o backend legado, ampliando a superfície e podendo bifurcar dados.

Os reconciliadores são ferramentas manuais e unidirecionais Supabase→AWS. O passo
de rollback “exportar delta AWS” não possui script identificado. Consequentemente,
o rollback documentado não é operacionalmente fechado.

## 12. Testes relacionados à migração

- frontend/regressão: `test/awsPreview.test.js`, `cognitoSso.test.js`,
  `authSessionSecurity.test.js`, `portalAuth.test.js`, `portalMagicLink.test.js`,
  `portalOnlyAccess.test.js`, `emailAlerts.test.js`, `import.test.js`,
  `workspaceIsolation.test.js`, `systemAdmin.test.js`, `security.test.js`,
  `automaticWorkspaceLink.test.js`, `accessRoles.test.js`,
  `apiChecklistSuggestions.test.js`, `checklistSuggestions.test.js`;
- AWS API/model: todos os 10 arquivos em `aws/api/test/*.test.mjs` cobrem auth,
  sessão browser/Portal, provisionamento, handler, repository, validator, modelo,
  notificações e exclusões;
- migração: apenas `aws/migration/test/shared.test.mjs`, focado em catálogo,
  transformação, papéis e batch retry;
- lacunas: não há teste contra Supabase/DynamoDB/S3 reais, migração/reconciliação
  end-to-end, hash de todos os campos, objeto órfão, delta/rollback, duplicidade dos
  dois schedulers, CRUD AWS de workspace/trial, convite frontend→Cognito,
  reclassificação/import/validator batch, nem contrato automático frontend ×
  validator para os suspeitos encontrados.

## Conferência com documentação oficial atual

- Cognito: refresh usa `REFRESH_TOKEN_AUTH`/`GetTokensFromRefreshToken` conforme a
  configuração do cliente; revogar um refresh token não invalida imediatamente JWTs
  já emitidos. A arquitetura deve considerar a validade de 15 minutos configurada e
  autorização server-side em toda requisição. [AWS — Using tokens with user pools](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html) e [Revoking tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html).
- DynamoDB: `BatchWriteItem` não é atômico, limita 25 operações e exige retry de
  `UnprocessedItems`; transações são necessárias para invariantes multi-item.
  [AWS BatchWriteItem](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html) e [Transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html).
- S3: metadata definida pelo usuário é criada no upload e precisa ser substituída
  por cópia para ser alterada; presigned URLs herdam as permissões/validade do
  emissor. [S3 object metadata](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html) e [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
- SAM: a validação lint requer `sam validate --lint` e usa cfn-lint; a CLI não
  estava disponível no host. [AWS SAM validate](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-validate.html).
- Azure SWA: configurações de aplicação do backend são distintas do JavaScript
  estático público; ambientes de preview são separados e podem ser fechados, mas
  não substituem um mecanismo de rollback de dados. [Application settings](https://learn.microsoft.com/azure/static-web-apps/application-settings) e [Preview environments](https://learn.microsoft.com/azure/static-web-apps/preview-environments).

## Riscos priorizados

### P0 — bloqueiam produção

1. **Drift de corte:** AWS já é default no runtime, contra a governança; fallback
   público cria split-brain e não há exportador de delta AWS.
2. **Contrato quebrado:** `module_key`, status de validação e `rejected_at` fazem
   operações centrais retornarem 400 no backend AWS.
3. **Administração incompleta:** workspaces/trial e criação de usuário permanecem
   Supabase-only; super_admin global não tem fluxo AWS equivalente ponta a ponta.
4. **SSO incompleto:** sugestões checklist exigem sessão Supabase mesmo no modo
   Cognito/AWS.
5. **Sem equivalentes transacionais:** importação, reclassificação, atribuição em
   lote e relatório de desempenho não possuem paridade AWS.
6. **Bypass de módulos:** `module_access` não vira `module_grants`; ausência é
   interpretada como allow-all pela API AWS.
7. **Sem evidência real:** reconciliadores não foram executados contra staging e os
   testes AWS nem iniciam neste host por dependências não instaladas.

### P1 — alto risco

1. dois jobs de alerta podem enviar notificações duplicadas;
2. reconciliação de tabelas valida contagens/chaves, não conteúdo; Storage ignora
   órfãos e confia em existência antes da verificação posterior;
3. operações multi-item AWS feitas no cliente não são atômicas;
4. papéis PT/EN podem rejeitar updates e divergir autorização;
5. catálogo `administrative_modules` e semântica de `module_key` não são migrados;
6. migração Cognito não preserva MFA, confirmação, senha ou sessões;
7. `BatchWriteItem` tem retries limitados e não fornece transação global da carga.

### P2 — dívida/controlabilidade

1. documentação arquitetural desatualizada e workflows duplicados;
2. metadata S3 não preserva todos os atributos da origem;
3. relatórios/filtros client-side podem degradar com paginação e volume;
4. Node 20 deste host está abaixo do requisito Node 22 declarado pelo SDK Supabase
   instalado, embora os testes frontend tenham passado com warnings.

## Resultado dos testes e checks

| Comando | Resultado | Evidência resumida |
|---|---|---|
| `npm ci --ignore-scripts` | passou com warning | lock raiz respeitado; Supabase SDK pede Node ≥22, host usa 20.20.2 |
| `npm ci --ignore-scripts --prefix api` | passou | lock da Azure Function respeitado |
| `npm run test:frontend` | passou | 152 testes, 0 falhas |
| `npm run test:aws-model` | falhou por ambiente/deps | 54 passaram, 7 arquivos não carregaram: AWS SDK/`jose` ausentes; não foi instalado porque não existe `package-lock.json` nesse pacote |
| `npm run test:aws-migration` | falhou por ambiente/deps | AWS SDK ausente; pacote tem apenas `pnpm-lock.yaml` |
| `npm run governance` | passou | “Controles mínimos de governança validados” |
| `npm run typecheck` | passou | `node --check` nos dois arquivos configurados |
| `sam validate --lint --template-file aws/template.yaml` | não executado | `sam` não está instalado (`command -v sam` sem saída) |

Uma falha por dependência ausente não equivale a falha do código, mas também não é
evidência positiva. A ausência de `package-lock.json` nos dois pacotes AWS impede
uma instalação compatível com a restrição desta auditoria.

## Bloqueadores ordenados para produção

1. restaurar governança do cutover: reconciliar runtime/default, remover seleção
   pública, implementar write freeze, rollout controlado e export/replay do delta;
2. alinhar e testar contratos (`module_key`, status, `rejected_at`, roles,
   workspace `trial/trial_ends_at`) antes de qualquer tráfego de escrita;
3. implementar paridade AWS de workspaces, convites/Cognito e super_admin global
   com autorização e auditoria;
4. migrar a Azure Function de sugestões para identidade Cognito/Portal derivada no
   servidor, sem dependência de sessão Supabase;
5. fornecer equivalentes transacionais para importação, reclassificação,
   atribuição em lote, reset/bulk e relatório de validação;
6. definir fonte única dos alertas e provar destinatários, idempotência e desligamento
   do caminho legado;
7. ampliar migração/reconciliação para `administrative_modules`, conteúdo de itens,
   objetos órfãos e regras/metadata Storage;
8. disponibilizar instalações reproduzíveis dos pacotes AWS pelo mecanismo de lock
   aprovado e executar toda a suíte em Node suportado;
9. executar `sam validate --lint`, deploy somente em staging, testes com dois tenants,
   CRUD/anexos, revogação, migração final e restore;
10. registrar aceite humano, hashes, alarmes, métricas e ensaio de rollback antes de
    mudar produção.

## Limites desta auditoria

Nenhum secret foi lido ou validado e nenhum serviço remoto do ambiente foi chamado.
Logo, a existência de recursos AWS, configuração real de Azure/Supabase, volumes,
contagens, hashes, CORS efetivo e estado de schedules não foi confirmada. Este
documento é baseline estático e de testes locais, não autorização de go-live.
