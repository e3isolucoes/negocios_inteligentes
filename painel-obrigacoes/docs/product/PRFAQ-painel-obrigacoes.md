# PRFAQ — Painel de Obrigações

> Documento de Working Backwards. O comunicado abaixo descreve a experiência-alvo de lançamento do produto; não afirma que todos os controles de produção já estejam concluídos. A seção de FAQ interna registra explicitamente os riscos abertos do assessment de prontidão.

## Comunicado de imprensa — visão de lançamento

### E3I lança Painel de Obrigações, SaaS B2B multi-tenant para transformar conformidade fiscal em uma operação rastreável

**Nova plataforma centraliza obrigações, responsáveis, prazos e comprovantes por empresa, com isolamento entre clientes, trilha auditável e uma arquitetura preparada para automação assistida sem transformar IA em fonte final de verdade.**

O Painel de Obrigações foi concebido para equipes que precisam executar conformidade fiscal de forma recorrente, com clareza sobre o que vence, quem é responsável, o que foi concluído e qual evidência sustenta cada entrega. Em vez de depender de planilhas, mensagens e pastas desconectadas, cada organização opera em seu próprio workspace, com dados e arquivos vinculados ao tenant e com controles de acesso aplicados em múltiplas camadas.

A experiência combina um aplicativo web com autenticação, gestão de obrigações e comprovantes, regras de autorização e uma evolução arquitetural em direção a um backend-for-frontend (BFF) com contratos explícitos. O desenho-alvo mantém PostgreSQL/RLS como última barreira de isolamento multi-tenant e reserva processamento assíncrono para capacidades como OCR, pesquisa, otimização e agentes. A intenção é crescer primeiro como monólito modular, reduzindo complexidade operacional, e extrair serviços apenas quando volume e organização justificarem.

Para automações e IA, o princípio do produto é simples: regras determinísticas continuam sendo a base para compliance e cálculos; modelos podem apoiar extração, pesquisa e propostas, mas resultados não confiáveis precisam de schema, policy, rastreabilidade e, quando houver efeito externo ou irreversível, aprovação humana. Processos automatizados devem ser versionados e executados como máquinas de estado duráveis, de forma que uma ação possa ser reproduzida, auditada e interrompida.

## Problema

A operação de conformidade fiscal B2B é vulnerável quando o trabalho fica espalhado entre pessoas, planilhas, caixas de entrada e arquivos sem vínculo operacional. Isso dificulta responder perguntas básicas e críticas: quais obrigações estão abertas, quem responde por cada uma, qual ocorrência foi concluída, onde está o comprovante e se a evidência pertence à empresa correta.

Em um produto SaaS multi-tenant, resolver a interface não basta. O risco de negócio é maior: qualquer falha de isolamento, autorização, retenção ou restauração pode transformar um ganho operacional em exposição de dados fiscais entre clientes. O assessment de prontidão identifica exatamente esse ponto: embora já existam RLS, CSP, testes e uma fundação de IA separada, a plataforma ainda possui riscos de produção que precisam ser tratados como gates, especialmente a divergência entre baseline SQL e migrações, a ausência de uma matriz RLS executada contra PostgreSQL real, controles administrativos ainda dependentes do browser, rate limiting/WAF distribuído e exercícios de backup, restore e rollback.

Há ainda uma transição de plataforma em curso. O inventário registra Azure Static Web Apps como frontend de produção, Supabase como backend de produção para PostgreSQL/Auth/RLS/Storage e uma stack AWS separada em staging. A validação AWS não representa, por si só, um corte do plano de dados. Por isso, a proposta de produto deve distinguir claramente experiência-alvo de lançamento, ambiente de produção atual e arquitetura em migração.

## Solução

O Painel de Obrigações organiza o trabalho de conformidade em workspaces isolados por cliente. Usuários autenticados operam as obrigações e suas evidências dentro do contexto de empresa autorizado, enquanto privilégios administrativos permanecem separados da operação cotidiana. O produto deve tornar a conclusão de uma obrigação um caso de uso explícito: localizar a obrigação no tenant correto, validar o ator e a ocorrência, registrar a conclusão de forma idempotente e associar o comprovante à mesma fronteira de workspace.

A arquitetura-alvo reforça essa experiência com um BFF responsável por autenticação, autorização, validação, idempotência e rate limiting; casos de uso separados da UI; adapters para dados, storage e provedores externos; e PostgreSQL/RLS como última barreira de autorização multi-tenant. Jobs de maior duração ou risco saem da requisição HTTP e passam para filas e workers isolados, com limites de tempo, custo, tentativas e privilégios.

A plataforma também deve ser operável como produto empresarial: schema reproduzível a partir de migrações, CI antes de deploy, artefato imutável promovido entre ambientes, observabilidade com logs estruturados/traces/métricas sem PII, SLOs explícitos, política de retenção/LGPD, backup e restore exercitados e runbooks para incidentes. O assessment propõe como SLO inicial 99,9% de disponibilidade mensal, p95 de leitura abaixo de 500 ms, p95 de comando abaixo de 1 s excluindo jobs, fila p95 abaixo de 60 s, erro server-side abaixo de 1%, RPO de até 15 minutos e RTO de até 2 horas; esses valores devem ser tratados como metas técnicas de prontidão, não como SLA contratual até aprovação de negócio.

> **Citação de cliente fictício:** “Antes, eu conseguia dizer que a obrigação tinha sido entregue, mas levava tempo para provar quem concluiu, qual empresa estava envolvida e onde estava o comprovante. Com o Painel de Obrigações, a execução e a evidência passam a fazer parte do mesmo fluxo, com contexto de empresa e histórico rastreável.” — *Mariana Costa, gerente fiscal de um grupo empresarial fictício.*

---

# FAQ interna

## 1. Qual é a promessa central do produto?

Dar a equipes B2B uma forma segura e auditável de executar obrigações de conformidade fiscal por empresa, conectando prazo, responsabilidade, conclusão e evidência no mesmo fluxo. A diferenciação arquitetural necessária para sustentar essa promessa é o isolamento multi-tenant verificável, não apenas filtros de interface.

## 2. Quem é o cliente-alvo?

O material de arquitetura não define segmentos comerciais, porte de empresa, ticket ou ICP quantitativo. A hipótese de produto deste PRFAQ é um SaaS B2B para equipes fiscais e operações de conformidade que administram uma ou mais empresas e precisam de execução recorrente com comprovantes e segregação por workspace. Segmentação, packaging e pricing ainda precisam de descoberta comercial própria.

## 3. O que está no escopo do produto de lançamento?

O núcleo é autenticação, workspaces/empresas, obrigações, ocorrências/conclusões, responsáveis, comprovantes e controles de acesso multi-tenant. Sugestões assistidas por IA podem existir como apoio, desde que autenticadas, limitadas, observáveis e sem assumir papel de fonte final de verdade. Automação avançada com processos/agentes só deve evoluir depois de versionamento, approvals, policies, idempotência e execução durável.

## 4. O que não devemos fazer agora?

Não iniciar a evolução com microserviços apenas por antecipação de escala. O assessment recomenda monólito modular com BFF, fronteiras explícitas e workers assíncronos. Também não devemos permitir que uma descrição em linguagem natural se transforme diretamente em ações externas: processo, versão e execução precisam ser modelados antes, com revisão humana e executor determinístico para validar schema e policy.

## 5. Qual é o estado atual da plataforma?

O inventário registra o frontend de produção em Azure Static Web Apps (`e3i-obrigacoes`), plano Free e região de recurso Central US, com deploy de produção determinado por `push` na `main` via `.github/workflows/azure-static-web-apps.yml`. O Supabase (`fsyginnpvonruifetjjs`) permanece como backend de produção para PostgreSQL, Auth, RLS e Storage, também em plano Free. A AWS possui uma stack de staging em `sa-east-1` (`e3i-staging-painel-obrigacoes`) com DynamoDB, Lambda, bucket privado/criptografado/versionado e API autenticada. O próprio inventário declara que a validação AWS ainda não representa corte do plano de dados.

## 6. Quais capacidades já reduzem risco?

O assessment registra módulos ES, RLS, funções com `search_path` fixo, CSP, testes com `node:test`, fallback sem LLM e fundação de IA separada. A primeira entrega da Fase 0 também passou a exigir sessão no endpoint de sugestões antes de acessar fontes externas/IA, limitou payload a 16 KiB, retirou histórico operacional enviado pelo browser, versionou lockfiles, colocou testes/verificação de sintaxe/auditoria antes do deploy e adicionou testes de autenticação e limite. Esses avanços reduzem risco, mas não substituem os gates ainda abertos.

## 7. Quais riscos continuam bloqueando a classificação de “SaaS multi-tenant pronto para produção”?

| Risco aberto | Por que importa para o produto | Critério de saída sugerido pelo assessment |
|---|---|---|
| Baseline SQL diverge das migrações | Instalação parcial ou fora de ordem pode produzir políticas globais e exposição cross-tenant | Migrações como única fonte de verdade, banco novo reproduzível, bootstrap pessoal removido e reset testado em CI |
| Isolamento RLS/RPC/Storage não foi provado por matriz completa | Filtros de aplicação não bastam como garantia multi-tenant | Matriz `tenant A / tenant B / super_admin / admin / gestor / membro / anônimo` verde em PostgreSQL real, incluindo CRUD, RPC e arquivos |
| Convite/criação administrativa ainda precisa sair do browser | Cadastro público e fluxo client-side ampliam abuso e enumeration | Convite server-side autenticado, validação de admin+tenant, service role somente no servidor, expiração, MFA privilegiado e auditoria |
| Rate limiting distribuído/WAF permanece aberto | Endpoint pago e APIs precisam resistir a abuso, bursts e custo não controlado | Limite por usuário/tenant/IP, budgets, WAF e controles de idempotência/tamanho em produção |
| Backup, restore e rollback não foram exercitados como gate | Um produto fiscal precisa recuperar evidência e operação, não apenas ter backups configurados | Restore real testado, rollback/roll-forward documentado e metas de RPO/RTO comprovadas |
| Política LGPD/retenção ainda não é executável | CNPJ, e-mails, comentários, comprovantes e prompts podem conter dados pessoais/fiscais | Inventário/classificação de dados, finalidade/base legal, retenção, legal hold, deleção/exportação/anonimização, criptografia e DPA aprovados |
| Casos de uso ainda estão acoplados a estado global/UI | Aumenta risco de regressão em fluxos críticos como concluir obrigação e upload | Extrair casos de uso para domain/application/ports/adapters, começando por conclusão de obrigação |
| Carregamento integral de tabelas no boot | Escala mal conforme histórico e tenants crescem | Paginação por cursor, projeções mínimas, agregações server-side, índices medidos e SLOs acompanhados |
| Observabilidade ainda precisa ser padronizada | Sem correlação e métricas, falhas de tenant, provedor e limite ficam indistinguíveis | Erros tipados, correlation ID, logs JSON, OpenTelemetry, métricas RED, auditoria separada e alertas por burn rate |
| Supply chain e promoção entre ambientes precisam amadurecer | Deploy direto pode criar divergência entre o que foi testado e o que chegou a produção | `validate -> security -> package -> staging -> smoke -> approval -> production`, artefato imutável, OIDC, SAST/secret scan e rollback testado |
| Infraestrutura/segredos não estão totalmente declarativos | Ambientes podem divergir e rotação ficar dependente de intervenção manual | Terraform/Bicep, ambientes separados, Key Vault/managed identity/OIDC, budgets e alertas |
| Concorrência, contratos e uploads maliciosos precisam de testes de sistema | Helpers unitários não provam idempotência, race conditions nem isolamento real | Testes de API/E2E/RLS, UUID cross-tenant, malware/PDF bomb, idempotência, timeouts, restore e carga |
| Agentes/processos ainda não têm todos os controles de produção | Efeitos externos não reproduzíveis criam risco operacional e de auditoria | Process/version/execution/approval modelados, outbox/fila/DLQ, schemas, policies, sandbox, limites e aprovação humana |

## 8. Qual é o principal risco de segurança multi-tenant?

A divergência entre `sql/schema.sql` e as migrações. O assessment destaca que o schema base contém políticas iniciais com leitura global para autenticados, blocos duplicados de workspaces e bootstrap de superusuário por e-mail, enquanto o isolamento completo aparece em migração posterior. O produto não deve declarar prontidão multi-tenant até que uma instalação do zero seja determinística e a matriz de isolamento prove que um tenant não consegue ler, escrever, referenciar ou baixar recursos de outro.

## 9. Como deve funcionar a autorização?

Autorização deve ser derivada da identidade e da associação ao workspace, validada no BFF/casos de uso e reforçada pelo banco como última barreira. IDs de tenant fornecidos pelo cliente não podem ser a única fonte de verdade. Funções `SECURITY DEFINER` precisam validar tenant/papel em cada entrada e ter `EXECUTE` restrito ao papel necessário. Papéis privilegiados precisam de MFA e trilha de auditoria.

## 10. Qual é a estratégia para comprovantes e dados fiscais?

Evidências devem pertencer explicitamente ao workspace, ter nomes/identificadores gerados no servidor e passar por validação de tamanho, extensão, MIME por conteúdo e controles contra malware ou bombs antes de OCR. O assessment recomenda metadados de classificação, retenção e legal hold, além de um workflow auditável que remova objeto e linha de dados de forma consistente quando a retenção permitir.

## 11. Qual é a estratégia de IA?

Usar IA como capacidade assistiva, não como autoridade de compliance. Regras determinísticas cobrem cálculos e decisões normativas; LLMs podem extrair ou propor; ML exige baseline, métrica, drift e rollback; otimização exige objetivo, restrições, limite de tempo e gap. Prompts/modelos devem ser versionados e avaliados como código, com dataset dourado anonimizado, testes de regressão, groundedness, prompt injection, PII e custo. Entradas e saídas devem obedecer schemas e não registrar prompts, tokens ou documentos brutos em logs.

## 12. Como a arquitetura deve evoluir sem overengineering?

Primeiro, monólito modular + BFF + PostgreSQL/RLS. Depois, extrair workers assíncronos para classes de trabalho que exigem fila, duração maior ou isolamento de risco, como OCR, pesquisa e agentes. Só extrair microserviços quando volume, ownership ou necessidade de escalabilidade independente justificarem a complexidade adicional.

## 13. Que SLOs devemos usar para o gate inicial?

O assessment propõe disponibilidade mensal de 99,9%, p95 de leitura abaixo de 500 ms, p95 de comando abaixo de 1 s excluindo jobs, fila p95 abaixo de 60 s, erro server-side abaixo de 1%, RPO de até 15 minutos e RTO de até 2 horas. Esses são alvos técnicos iniciais. O documento não define SLA comercial, créditos, suporte ou penalidades contratuais.

## 14. Como será feito deploy e promoção?

O inventário define `push` na `main` como gatilho do único pipeline autorizado de Azure para produção, evitando deploys duplicados. A direção do assessment é evoluir para validação e segurança antes do package, deploy em staging, smoke, aprovação e promoção do mesmo artefato imutável para produção, com canary/blue-green e rollback automático/testado. A stack AWS listada é de staging e não deve ser tratada como produção apenas por ter sido validada.

## 15. O que precisamos decidir com negócio antes de avançar para agentes e contratos enterprise?

O assessment deixa explícito que ainda precisam virar ADRs: volume de tenants/usuários/execuções, países e residência de dados, classes de documento, prazos legais de retenção, sistemas que agentes poderão alterar, tolerância de custo/latência, necessidade de aprovação dupla e RPO/RTO contratual. O código não é evidência suficiente para inferir essas decisões.

## 16. Como mediremos sucesso do produto?

Os documentos de origem não definem metas comerciais ou de adoção. Antes de GA, Produto deve definir baseline e metas para ativação de workspace, cobertura de obrigações acompanhadas, taxa de conclusão dentro do prazo, percentual de conclusões com evidência válida, tempo para localizar comprovante, retenção de contas e volume de incidentes/erros por tenant. Esses indicadores são proposta de gestão de produto deste PRFAQ e precisam de validação com clientes; os únicos números já propostos nos documentos são os SLOs técnicos descritos acima.

---

# FAQ externa

## O que é o Painel de Obrigações?

É uma plataforma SaaS B2B para organizar a execução de obrigações de conformidade fiscal por empresa. Ela conecta obrigações, responsáveis, ocorrências de conclusão e comprovantes em um fluxo rastreável.

## Para quem é o produto?

Para equipes que administram obrigações fiscais e precisam acompanhar execução e evidências de uma ou mais empresas. O produto foi desenhado para uso multi-tenant, com cada organização operando em seu contexto autorizado.

## Como o produto ajuda no dia a dia?

Centraliza o que precisa ser feito, por quem e para quando; registra a conclusão; e mantém o comprovante associado ao contexto correto. Isso reduz a dependência de controles paralelos e facilita auditoria operacional e recuperação de evidências.

## Os dados de uma empresa ficam separados dos de outra?

Esse é um requisito fundamental do produto. A arquitetura exige isolamento por workspace, autorização server-side e RLS no banco como última barreira. A oferta de produção só deve ser considerada pronta quando a matriz de testes cross-tenant estiver verde em banco, APIs, RPCs e arquivos.

## Usuários comuns podem operar obrigações e comprovantes?

A experiência-alvo separa operação cotidiana de privilégios administrativos. Usuários ativos e autorizados ao workspace devem conseguir executar o trabalho permitido no Painel sem receber automaticamente gestão de usuários ou controles administrativos.

## O Painel guarda comprovantes?

Sim, comprovantes fazem parte do fluxo de evidência. A arquitetura prevê vínculo ao workspace e proteção de storage. Para a prontidão enterprise, ainda são gates explícitos a política executável de retenção/LGPD, validação de arquivos, criptografia, backup e restore exercitados.

## O produto usa inteligência artificial para decidir obrigações fiscais?

Não como fonte final de verdade. A direção de produto é usar regras determinísticas para compliance e cálculos e IA para apoio em tarefas como extração, pesquisa ou propostas. Saídas de modelos devem ser validadas por schema e policy e, quando houver efeito externo relevante, passar por aprovação humana.

## A plataforma automatiza processos?

A arquitetura está preparada para evoluir nessa direção, mas automações precisam ser versionadas, auditáveis e executadas por uma máquina de estados durável. Agentes com efeitos externos não devem ser liberados antes de existirem controles de idempotência, limites, sandbox, policies, aprovação e rollback.

## Quais níveis de disponibilidade e desempenho são esperados?

O assessment propõe como metas técnicas iniciais 99,9% de disponibilidade mensal, p95 de leitura abaixo de 500 ms e p95 de comando abaixo de 1 s excluindo jobs. SLA contratual, suporte e créditos não estão definidos nos documentos atuais e precisam ser estabelecidos antes de uma oferta comercial que os prometa.

## Onde os dados ficam hospedados?

A plataforma atual utiliza serviços em mais de uma nuvem e a residência de dados é uma decisão de negócio ainda pendente de ADR. Para clientes com exigências de localização, a resposta contratual deve especificar ambiente, região, subprocessadores e retenção antes da contratação; não é seguro inferir esse compromisso apenas da topologia atual.

## Como a E3I protege credenciais e segredos?

O inventário define locais autorizados para tokens e credenciais, proíbe registrar segredos em documentos, issues ou logs e evita credenciais AWS no frontend. A direção de produção é ampliar uso de OIDC/managed identity, rotação e cofre de segredos, mantendo chaves privilegiadas fora do navegador.

## Como funciona recuperação em caso de falha?

Backup, restore e rollback fazem parte dos gates de produção. O alvo técnico proposto é RPO de até 15 minutos e RTO de até 2 horas, mas esses objetivos precisam ser exercitados e comprovados antes de se tornarem compromisso contratual.

## O produto está pronto para ser vendido como SaaS enterprise multi-tenant hoje?

Os documentos de arquitetura não sustentam essa afirmação ainda. Eles registram progresso relevante, mas mantêm riscos de alto impacto e uma Definition of Done de produção ainda aberta. O lançamento comercial com promessa enterprise deve ocorrer somente após os gates de isolamento, segurança, resiliência, observabilidade, LGPD e operação descritos neste PRFAQ serem concluídos e evidenciados.

---

## Critério de decisão para lançamento

A decisão de GA deve ser baseada em evidência, não apenas em existência de funcionalidades. No mínimo: banco reproduzível por migrações, nenhuma leitura/escrita cross-tenant na matriz RLS/RPC/Storage, convite privilegiado server-side com MFA/auditoria, rate limiting/WAF operacional, CI/CD com promoção controlada, SLO/telemetria ativos, política LGPD/retenção aprovada e backup/restore/rollback exercitados. Automação por agentes não é pré-requisito para lançar o núcleo de obrigações; se for incluída no escopo comercial, adiciona os gates de versionamento, policies, sandbox, idempotência, aprovação humana e evals/rollback de modelo.