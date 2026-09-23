# Consolidação dos PRs históricos do Portal E3I

Fonte histórica: `e3isolucoes/portal-e3i-solucoes`.

Destino canônico: `e3isolucoes/negocios_inteligentes`.

Este documento registra a consolidação de todos os PRs que constam como **merged** no repositório histórico. A regra de migração é semântica: código e contratos ainda válidos são trazidos; implementações superadas não substituem versões mais novas; workflows antigos não são reativados em paralelo quando já existe pipeline canônico equivalente.

## Garantias da consolidação

- migrations SQL, migração AWS, documentação, IA e testes históricos foram trazidos para o repositório canônico;
- a suíte histórica do Painel passa a rodar no CI canônico;
- testes AWS e de migração são executados nos pipelines atuais;
- primeiro acesso, Administração Central, client-tool auth e reconciliação de usuários permanecem no Portal canônico;
- OIDC AWS é o caminho preferencial quando a variável federada está configurada;
- o vendoring de Supabase é materializado em versão pinada no CI/deploy, sem versionar um bundle minificado de terceiro;
- artefatos binários de evidência, ZIPs históricos e configurações de agentes não são runtime da aplicação e não são necessários para reproduzir os PRs;
- bootstrap/policies sensíveis não são copiados cegamente para evitar ampliar permissões ou duplicar infraestrutura.

## Inventário

| PR histórico | Título | Tratamento no canônico |
|---|---|---|
| #1 | feat: consolidar Painel no Portal E3I | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #3 | fix(painel-obrigacoes): restore panel load by adding safe `js/config.js` and strengthen Supabase client validation | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #4 | Introduce `writeGrant` for entity permissions and add public Supabase fallback config | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #5 | Make auxiliary panel data non-blocking, add per-entity `writeGrant`, and add public Supabase fallback | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #6 | fix(security): require cryptographic nonce for portal provisioning, persist nonce to prevent replay, and preserve Cognito credentials | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #7 | fix(repository): move uniqueness lock when completion obligation/occurrence changes and add tests | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #8 | feat: validar escritas por entidade e impor relações por workspace | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #9 | feat(auth): mover refresh token para cookie HttpOnly/Secure + BFF session endpoints, access token apenas em memória e ajustes de CSP/vendoring | Preservado por referência local + materialização pinada do Supabase no CI/deploy; sessão/CSP mantidos pela implementação canônica mais nova. |
| #10 | feat: tornar exclusão de arquivos confiável | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #12 | fix: return 404 for missing records and define idempotent DELETE semantics | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #13 | docs: add baseline audit for Supabase → AWS migration | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #14 | fix: alinhar contrato do frontend com a API AWS | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #15 | feat: adicionar administração IAM na AWS | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #16 | fix: authorize checklist suggestions through AWS identity | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #17 | feat: mover alertas diários para Scheduler + Lambda (DynamoDB datasource, SES, tests) | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #18 | feat: adicionar prova de conteúdo à migração AWS | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #19 | fix: renovar sessão Cognito do Portal quando refresh token expira | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #20 | Allow missing workspace document and improve Cognito session handling for migrated accounts | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #22 | fix: aceitar timestamp Unix no SSO do Portal | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #23 | fix: permitir execução dinâmica do OCR sem liberar scripts arbitrários | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #24 | fix: permitir acesso de contas anteriores à migração | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #25 | Improve errorResponse: map upstream errors to 502, add structured logs, and tests | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #26 | Handle non-JSON portal SSO responses and surface SSO error details | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #28 | fix: endurecer tratamento de erros SSO | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #29 | fix: validar configuração segura no CI | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #30 | fix: reforçar isolamento dos alertas AWS | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #31 | fix: validar manifestos de migração por execução | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #33 | feat: endurecer migração de comprovantes | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #34 | fix: tornar provisionamento SSO idempotente | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #35 | fix: evitar 401 ao abrir painel sem sessão | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #36 | docs: alinhar conexões do GitHub com Azure e AWS | Documentação/conexões traduzidas para os workflows canônicos. |
| #37 | CI: Add cloud-connection script and tighten AWS/Azure deployment workflows | OIDC AWS restaurado como caminho preferencial, com fallback compatível. |
| #39 | fix: alinhar acesso do Painel de Obrigações ao Portal | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #40 | Fix Azure/AWS deployment pipelines | Pipelines antigos substituídos pelos workflows canônicos de Portal, Frontend e AWS. |
| #41 | Fix Portal launch compatibility after nonce hardening | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #43 | Consolidate AWS staging deployer bootstrap permissions | Bootstrap/deployer sensível não é copiado cegamente; requisitos são preservados no deploy canônico e validações. |
| #44 | Allow members to manage obligations | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #45 | Add Portal tool access administration screen | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #46 | Reconcile migrated Portal identities before AWS provisioning | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #47 | Fix IAM prefix for SAM-generated staging roles | Compatibilidade IAM/SAM preservada pela stack/template atual e testes. |
| #48 | Add module filters and movement competence | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #49 | Simplify module selector display | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #50 | Reconcile migrated Portal users and force secure first-login password | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #51 | Reduce Portal auth console errors during first login | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #52 | Fix migrated-user first-login flow across fetch and XHR | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #53 | Fix client-tool launch authentication and Portal preview CSP | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #54 | Add isolated E3I Intelligence foundation contracts | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #56 | Add tenant-scoped E3I Intelligence Mapping Core | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #58 | Add isolated Mapping API contract and repository boundary | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #60 | Add centralized Portal access and settings administration | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #63 | Add enterprise user lifecycle and E3I brand theme to Portal admin | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #64 | fix: serve Admin v2 logo through explicit route | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #65 | fix: alinhar tema admin e liberar operação básica de obrigações | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #67 | fix: inline E3I brand asset in Admin v2 | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #70 | Fix member task actions and completion workflow | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #72 | Add cancel flow to first-login password dialog | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #73 | Validate first-login cancel behavior in CI | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #74 | Fix gestor saving activity changes in Obrigações Acessórias | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #75 | Fix admin editing legacy obligations | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #76 | Fix legacy obligations without version on first edit | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #77 | Freeze activity competence and historical structure | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #80 | Cleanup obsolete admin and alerting legacy | Cleanup representado pelo estado final: componentes removidos não são reintroduzidos. |
| #83 | Restrict tool administration to Admin and explicit delegates | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #84 | Redesign Painel de Obrigações com shell premium | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |
| #85 | Preserve immutable Cognito schema during AWS staging updates | Contrato `active_workspace_id` preservado com teste compatível com PreTokenGeneration/entitlements atuais. |
| #86 | Padronizar visual de toda a ferramenta com design system único | Migrado, incorporado por versão canônica mais nova ou coberto pela suíte histórica restaurada. |


## Cobertura final

A auditoria final identificou **66 PRs mesclados** no repositório histórico.

A consolidação cobre:
- código e testes ainda válidos no caminho canônico;
- migrations SQL e AWS;
- bootstrap e políticas históricas de infraestrutura;
- assets de ícones e OCR/Tesseract;
- documentação, ADRs, governança e runbooks;
- E3I Intelligence e fundação de IA;
- fluxos de autenticação, SSO, primeiro acesso, Administração Central e autorização;
- histórico de alterações operacionais e regressões do Painel.

Os workflows antigos foram preservados em `docs/migration/legacy-workflows/` para rastreabilidade, mas **não** foram reativados em `.github/workflows/`, pois isso duplicaria deploys e poderia publicar por caminhos obsoletos. Seus efeitos foram traduzidos para os workflows canônicos atuais.

O teste histórico Cognito que exigia ausência de `PreTokenGeneration` / lifecycle foi preservado em `docs/migration/legacy-tests/`. O gate ativo equivalente é `cognito-schema-current-compat.test.mjs`, que preserva `active_workspace_id` sem remover a arquitetura de entitlements atual.
