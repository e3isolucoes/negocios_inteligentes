# Avaliação de arquitetura e plano de prontidão para produção

**Data da avaliação:** 22/08/2026  
**Escopo:** frontend JavaScript/PWA, Supabase/PostgreSQL, Azure Static Web Apps/Functions, automação e fundação de IA existentes neste repositório.

## Resumo executivo

O sistema já tem decisões positivas: módulos ES, RLS, funções com `search_path`
fixo, CSP, testes com `node:test`, fallback sem LLM e uma fundação de IA separada.
Entretanto, **a implantação ainda não deve ser tratada como SaaS multi-tenant de
produção**. O maior risco é a divergência entre `sql/schema.sql` e as migrações:
o schema base ainda cria políticas globais (`using (true)`), repete blocos e contém
bootstrap de superusuário por e-mail, enquanto o isolamento correto aparece numa
migração posterior. Uma instalação parcial ou fora de ordem pode expor dados.

O alvo recomendado não é iniciar com microserviços. É um **monólito modular com
backend-for-frontend (BFF)**, contratos explícitos, banco como última barreira de
autorização e workers assíncronos para OCR, pesquisa, otimização e agentes. Essa
forma reduz complexidade operacional agora e preserva fronteiras que podem ser
extraídas quando volume e equipes justificarem.

## Estado de execução

Esta primeira entrega de implementação concluiu parte da Fase 0:

- o endpoint de sugestões agora exige e valida a sessão Supabase antes de acessar
  fontes externas ou IA, limita o payload a 16 KiB e deixou de receber histórico
  operacional pelo navegador;
- o cliente envia o bearer token da sessão sem expor credenciais do provedor;
- lockfiles da aplicação e da API foram versionados;
- o deploy passou a depender de testes, verificação de sintaxe e auditoria de
  dependências da aplicação e da API;
- foram adicionados testes de autenticação e limite do endpoint, e corrigido o gate
  de cache-busting que estava desatualizado.

Permanecem abertos nesta fase: reconciliar o baseline SQL, executar uma matriz RLS
contra PostgreSQL real, retirar o convite administrativo do browser, configurar
rate limiting distribuído/WAF e exercitar backup, restore e rollback. Os itens não
devem ser considerados concluídos apenas por existirem recomendações neste documento.

## Arquitetura observada (as-is)

```text
Browser (HTML/CSS/ES modules + estado global)
  |-- Supabase JS --------------------> Auth / PostgREST / Storage / PostgreSQL
  `-- POST /api/checklist-suggestions -> Azure Function -> fonte oficial + OpenAI

GitHub Actions -> Azure Static Web Apps/Functions
GitHub Actions manual -> script de alertas -> Supabase (service role) + Resend
```

### Pontos fortes a preservar

- UI, adaptadores Supabase e funções puras já estão parcialmente separados em
  `js/ui`, `js/api`, `dateUtils.js` e `riskModel.js`.
- O banco implementa RLS e a migração de isolamento inclui `workspace_id`, chaves
  compostas e validação de relações entre tenants.
- A API limita tamanho de entrada, fixa fontes de scraping, usa timeout e degrada
  para um modelo operacional quando a IA falha.
- A CSP bloqueia objetos, framing, câmera, localização e microfone.
- A fundação em `src/ai` já nomeia gateways, roteamento, policies, guards, tools,
  skills, traces e contabilização de uso.

## Arquitetura-alvo incremental

```text
Web App
  -> BFF/API (autenticação, autorização, validação, idempotência, rate limit)
      -> Application use cases
          -> Domain: Process, ProcessVersion, Execution, Task, Evidence, AgentRun
          -> Ports: repositories, queue, model gateway, optimizer, search, telemetry
      -> Adapters: Supabase/Postgres, Storage, OpenAI/Gemini, browser/search
      -> Queue -> workers isolados (OCR, ML, PO, LLM/tool execution)

PostgreSQL/RLS = última barreira multi-tenant
OpenTelemetry -> logs estruturados, traces e métricas -> alertas/SLOs
```

O fluxo de automação deve ser uma máquina de estados durável:
`draft -> reviewed -> approved -> queued -> running -> succeeded|failed|cancelled`.
Uma descrição em linguagem natural gera uma **versão imutável do processo**;
nenhum agente executa efeitos externos antes de aprovação, policy e validação.

---

# Checklist priorizado

## Alto impacto — bloquear produção até resolver

### Segurança e proteção de dados

- [ ] **Tornar migrações a única fonte de verdade e criar um schema reproduzível.**
  - **Evidência:** `sql/schema.sql` contém políticas iniciais com leitura global
    para autenticados, dois blocos quase iguais de `workspaces` e promoção de um
    e-mail pessoal; o isolamento completo está em
    `sql/migrations/20260815_isolate_workspaces_by_cnpj.sql`.
  - **Risco:** drift, instalação não determinística e vazamento entre clientes.
  - **Ação:** adotar Supabase CLI (ou Flyway/Liquibase), nunca editar uma migração
    aplicada, gerar `schema.sql` apenas como artefato e testar do banco vazio ao
    estado atual em CI. Remover bootstrap pessoal do DDL; fazer bootstrap com um
    comando auditável e secret/variável temporária.
  - **Exemplo de gate:**

    ```yaml
    - run: supabase start
    - run: supabase db reset
    - run: npm run test:rls
    - run: git diff --exit-code -- db/generated-schema.sql
    ```

- [ ] **Provar RLS multi-tenant em todas as tabelas, views, RPCs e Storage.**
  - **Evidência:** a migração mais nova melhora as policies, mas funções
    `SECURITY DEFINER` atravessam RLS e precisam validar tenant e papel em cada
    entrada; o endpoint de IA é `anonymous`.
  - **Ação:** criar uma matriz automatizada `tenant A / tenant B / super_admin /
    admin / gestor / membro / anônimo` cobrindo `SELECT`, `INSERT`, `UPDATE`,
    `DELETE`, RPC e arquivo. Revogar `EXECUTE` de `public` em toda função definer,
    conceder apenas ao papel necessário e consultar o tenant a partir de
    `auth.uid()`, nunca do payload.
  - **Exemplo SQL:**

    ```sql
    revoke all on function public.run_process(uuid, text) from public, anon;
    grant execute on function public.run_process(uuid, text) to authenticated;

    create policy execution_tenant_select on public.process_executions
      for select to authenticated
      using (workspace_id = public.current_workspace_id());
    ```

- [ ] **Autenticar e limitar a Azure Function de sugestões.**
  - **Evidência:** `api/checklist-suggestions.js` registra `authLevel:
    'anonymous'`, aceita histórico enviado pelo cliente e pode consumir scraping e
    tokens pagos sem identidade, quota ou rate limit.
  - **Ação:** validar JWT Supabase no BFF, derivar `workspace_id` do token/perfil,
    buscar exemplos no servidor, aplicar limite por usuário/tenant/IP, limite de
    custo, idempotency key e tamanho total do body. Não registrar prompt, token ou
    documento bruto.
  - **Exemplo de middleware (conceitual):**

    ```js
    const identity = await auth.verifyBearer(request.headers.get('authorization'));
    await quota.consume(`checklist:${identity.workspaceId}:${identity.userId}`, 1);
    const input = ChecklistRequest.parse(await readJson(request, { maxBytes: 16_384 }));
    const history = await checklistRepository.examples(identity.workspaceId, input.obligation.id);
    ```

- [ ] **Eliminar criação administrativa de conta pelo navegador.**
  - **Evidência:** `js/api/adminUsers.js` usa `auth.signUp()` com cliente temporário;
    isso depende de cadastro público habilitado, não garante convite transacional
    e amplia abuso/enumeration.
  - **Ação:** mover convite para Function autenticada, validar `admin` + tenant,
    usar Admin API com `service_role` somente no servidor/Key Vault, expiração de
    convite, MFA para papéis privilegiados e trilha de auditoria. Tokens de sessão
    devem ter vida curta, rotação de refresh e revogação server-side.
  - **Exemplo de contrato:**

    ```http
    POST /api/v1/members/invitations
    Authorization: Bearer <access-token>
    Idempotency-Key: <uuid>
    {"email":"pessoa@empresa.com","role":"membro"}
    ```

- [ ] **Definir classificação, retenção e proteção LGPD.**
  - **Risco:** comprovantes, CNPJ, e-mails, comentários e prompts podem conter dados
    pessoais/fiscais; hoje não há política executável de retenção ou deleção.
  - **Ação:** inventário de dados, base legal/finalidade, minimização, prazo por
    classe, legal hold, exportação/anonimização, criptografia e KMS, backup
    criptografado, teste de restauração e DPA com provedores de IA. Redigir prompts
    antes do envio e desabilitar treinamento/retenção no provedor quando aplicável.
  - **Exemplo:** metadados `classification`, `retention_until` e `legal_hold` em
    evidências; job elimina objeto e linha no mesmo workflow auditável.

### Arquitetura e design patterns

- [ ] **Separar casos de uso do estado global e da UI.**
  - **Evidência:** `js/data.js` tem mais de mil linhas e mistura orquestração,
    estado, regras, chamadas remotas, mensagens e callbacks; `STATE` é um singleton.
  - **Ação:** organizar por feature e usar arquitetura hexagonal: `domain`
    (entidades/regras puras), `application` (casos de uso), `ports` (interfaces),
    `adapters` (Supabase/IA) e `presentation`. Começar por concluir obrigação, que
    tem upload, checklist, validação e concorrência.
  - **Exemplo com injeção de dependências:**

    ```js
    export const makeCompleteObligation = ({ obligations, evidence, clock, logger }) =>
      async ({ actor, obligationId, occurrence, file, idempotencyKey }) => {
        const obligation = await obligations.get(actor.workspaceId, obligationId);
        obligation.assertCanComplete(actor, occurrence);
        const stored = file ? await evidence.put(actor.workspaceId, file) : null;
        const result = await obligations.complete({ obligation, occurrence, stored,
          completedAt: clock.now(), idempotencyKey });
        logger.info('obligation.completed', { executionId: result.id });
        return result;
      };
    ```

- [ ] **Modelar processo, versão e execução antes de adicionar agentes.**
  - **Risco:** transformar texto diretamente em ações gera automação não
    reproduzível e impossível de auditar.
  - **Ação:** separar `process_definitions`, `process_versions` imutáveis,
    `process_steps`, `process_executions`, `step_executions`, `artifacts`,
    `approvals` e `agent_runs`. Cada step declara tipo (`deterministic`, `ml`,
    `optimization`, `llm`, `human`), schema de entrada/saída, timeout, retry,
    permissões e compensador. Publicação exige revisão humana.
  - **Exemplo de step:**

    ```json
    {"type":"llm","inputSchema":"process.extract.v1","outputSchema":"bpmn.draft.v1",
     "timeoutMs":15000,"maxAttempts":2,"tools":["knowledge.search"],
     "approval":"before_external_effect","onFailure":"human_review"}
    ```

- [ ] **Executar ferramentas/agents fora da requisição HTTP e com privilégio mínimo.**
  - **Ação:** fila durável + transactional outbox, worker por classe de risco,
    allowlist de tools, credenciais efêmeras, egress restrito, sandbox, limite de
    custo/tempo/passos e aprovação humana para efeitos irreversíveis. O LLM propõe;
    um executor determinístico valida schema e policy antes de agir.
  - **Exemplo de idempotência:** `unique(workspace_id, process_version_id,
    idempotency_key)` e evento outbox gravado na mesma transação da execução.

### DevOps e infraestrutura

- [ ] **Criar CI antes do deploy e promover artefato imutável entre ambientes.**
  - **Evidência:** o workflow de Azure faz checkout e deploy direto; não roda testes,
    typecheck, lint, audit, teste de migração ou SAST. Actions usam tags móveis e
    não existe lockfile versionado.
  - **Ação:** jobs `validate -> security -> package -> deploy-staging -> smoke ->
    approval -> deploy-production`; versionar lockfiles, usar `npm ci`, pin por SHA,
    OIDC em vez de segredo longevo e ambientes GitHub protegidos. Produção deve
    implantar o mesmo artefato testado, com canary/blue-green e rollback automático.
  - **Exemplo:**

    ```yaml
    - run: npm ci --ignore-scripts
    - run: npm test
    - run: npm run typecheck
    - run: npm audit --omit=dev --audit-level=high
    - run: gitleaks detect --no-banner
    - run: trivy fs --exit-code 1 --severity HIGH,CRITICAL .
    ```

- [ ] **Provisionar ambientes e segredos como infraestrutura declarativa.**
  - **Ação:** Terraform/Bicep para Static Web App, Functions, Key Vault,
    observabilidade, DNS/WAF, budgets e alertas. Separar projetos Supabase e chaves
    de dev/staging/prod; nunca usar `service_role` no browser. Rotacionar secrets e
    usar managed identity/OIDC onde suportado.

### Performance e resiliência

- [ ] **Remover full-table loads do boot e definir SLOs.**
  - **Evidência:** `loadAll()` carrega em paralelo tabelas inteiras; os adaptadores
    usam `select('*')`. Isso reduz latência inicial apenas em bases pequenas e
    aumenta memória, egress e risco de timeout conforme o histórico cresce.
  - **Ação:** projeções mínimas, paginação cursor-based, intervalo de datas,
    agregações server-side/materialized views e cache por tenant. Indexar consultas
    observadas com `EXPLAIN (ANALYZE, BUFFERS)`, não por suposição.
  - **Exemplo:**

    ```js
    db.from('obligations')
      .select('id,name,due_day,frequency,responsible_id,company_id')
      .eq('workspace_id', workspaceId)
      .gt('id', cursor).limit(100);
    ```
  - **SLO inicial:** disponibilidade mensal 99,9%; p95 leitura < 500 ms; p95 comando
    < 1 s excluindo jobs; fila p95 < 60 s; erro server-side < 1%; restauração
    testada com RPO <= 15 min e RTO <= 2 h.

## Médio impacto — executar nas duas iterações seguintes

- [ ] **Padronizar erros e observabilidade ponta a ponta.**
  - **Evidência:** há muitos `console.error` e mensagens genéricas; a Function
    captura falhas sem telemetria, tornando indisponibilidade, limite e resposta
    inválida indistinguíveis.
  - **Ação:** erro tipado (`code`, `safeMessage`, `retryable`, `cause`), correlation
    ID, logs JSON, OpenTelemetry, métricas RED e auditoria separada de logs técnicos.
    Redigir tokens, e-mail, comprovantes, prompts e respostas. Alertar por burn rate.
  - **Exemplo:**

    ```js
    logger.error('ai.provider_failed', {
      traceId, workspaceId, provider, model, durationMs, retryable: true,
      errorCode: 'AI_PROVIDER_TIMEOUT' // sem prompt, resposta ou bearer token
    });
    ```

- [ ] **Aplicar timeout, retry com jitter, circuit breaker e budget em todos os I/Os.**
  - Retries apenas para operações idempotentes e erros transitórios (`429`, `502`,
    `503`, timeout); respeitar `Retry-After`; limitar tentativas. Upload e comandos
    recebem idempotency key. Circuit breaker evita cascata quando IA, OCR ou fonte
    externa cai; fila morta preserva jobs para reprocessamento controlado.

- [ ] **Validar contratos nas fronteiras.**
  - Usar JSON Schema/Zod no BFF e constraints no banco. Sanitização de HTML é
    complementar; preferir `textContent` a `innerHTML`. Validar MIME pelo conteúdo,
    tamanho, extensão, malware e image/PDF bombs antes de OCR. Nomes de objeto devem
    ser UUID gerado no servidor, não nome fornecido pelo usuário.
  - **Exemplo:**

    ```js
    const ProcessDraft = z.object({ description: z.string().trim().min(20).max(20_000) });
    const payload = ProcessDraft.parse(await request.json());
    ```

- [ ] **Versionar e avaliar prompts/modelos como código.**
  - Registrar `prompt_version`, provedor/modelo, hashes de entrada/saída, custo,
    latência, policy decision e aprovação. Criar dataset dourado anonimizado,
    testes de regressão, groundedness, prompt injection, PII e custo antes de trocar
    modelo. Saída de LLM deve obedecer schema estrito e ser tratada como não
    confiável; fontes precisam de snapshot/hash e citação.

- [ ] **Definir estratégia por tipo de inteligência.**
  - Regras determinísticas para compliance e cálculos; ML somente com baseline,
    métrica, drift e rollback; Pesquisa Operacional com função objetivo, restrições,
    limite de tempo e gap; LLM para extração/proposta, jamais como fonte final de
    verdade. Toda decisão guarda explicação e versão dos dados/modelo.

- [ ] **Fortalecer supply chain e frontend.**
  - Fixar dependências, remover CDN em runtime ou hospedar artefatos com SRI, gerar
    SBOM e assinar release. Substituir CSP com `'unsafe-inline'` por nonce/hash,
    acrescentar HSTS e `Cross-Origin-*` após testar OCR/PDF workers. Adotar lint,
    formatter e typecheck real (TypeScript ou `// @ts-check` + JSDoc); o script atual
    de `typecheck` executa apenas `node --check` em dois arquivos.

- [ ] **Testar concorrência e contratos, não apenas helpers.**
  - Acrescentar testes de API, migration/RLS em PostgreSQL real, browser E2E,
    acessibilidade, upload malicioso, idempotência, race conditions, timeouts,
    restore e carga. Um teste deve tentar UUID conhecido de outro tenant em cada
    FK/RPC/Storage e esperar negação.

## Baixo impacto — melhoria contínua

- [ ] **Formalizar ADRs e ownership.** Registrar decisões de tenancy, BFF, fila,
  provedores de IA e retenção; adicionar `CODEOWNERS`, template de threat model e
  revisão obrigatória para SQL/policies/workflows.
- [ ] **Gerar documentação de API e eventos.** OpenAPI para HTTP e AsyncAPI para
  filas; exemplos devem ocultar dados reais. Versionar contratos com compatibilidade.
- [ ] **Criar runbooks.** Vazamento suspeito, chave exposta, provedor de IA fora,
  fila acumulada, migração falha, restore e rollback. Executar game day trimestral.
- [ ] **Aplicar budgets e FinOps.** Limite por tenant/agente/modelo, alarme de custo,
  cache seguro de respostas determinísticas e roteamento do modelo mais barato que
  atenda à qualidade. Exibir custo estimado antes de execuções grandes.

## Plano de entrega sugerido

### Fase 0 — 1 semana: contenção

1. Congelar alterações de schema não emergenciais.
2. Remover bootstrap pessoal, reconciliar baseline/migrações e criar teste de reset.
3. Executar a matriz RLS e fechar o endpoint anônimo de IA.
4. Versionar lockfiles e colocar testes/audit antes do deploy.
5. Confirmar backups, restore, rotação de secrets e responsável por incidentes.

**Critério de saída:** banco novo reproduzível, nenhuma leitura/escrita cross-tenant,
endpoint pago autenticado/limitado e rollback exercitado.

### Fase 1 — 2 a 4 semanas: fundação profissional

1. Introduzir BFF e mover convite, IA e comandos sensíveis para o servidor.
2. Extrair o primeiro caso de uso de `data.js` com ports/adapters e DI.
3. Adicionar logs/traces/métricas, SLOs, dashboards e alertas.
4. Paginar boot, medir queries e corrigir índices com evidência.
5. Criar staging isolado e promoção de artefato com aprovação.

### Fase 2 — 4 a 8 semanas: motor de processos e agentes

1. Implementar definição/versionamento/execução/aprovação de processos.
2. Introduzir outbox, fila, worker, idempotência, DLQ e cancelamento.
3. Integrar o harness de IA ao BFF/worker com guards, policy, evals e custo.
4. Adicionar um agente somente leitura; depois um agente com efeito reversível e
   aprovação. Liberar progressivamente por feature flag/tenant.

## Definition of Done para produção

- [ ] Threat model revisado para auth, tenancy, uploads, agentes e supply chain.
- [ ] Migrações reproduzíveis e rollback/roll-forward documentado.
- [ ] Matriz RLS/RPC/Storage verde em PostgreSQL real.
- [ ] MFA e auditoria para papéis privilegiados; convite server-side.
- [ ] CI bloqueia teste, lint/typecheck, SAST, secret scan e vulnerabilidade alta.
- [ ] Staging separado; deploy canary/blue-green e rollback testado.
- [ ] SLO, telemetria sem PII e alertas de burn rate ativos.
- [ ] Backup/restore atende RPO/RTO e foi exercitado.
- [ ] Política LGPD/retenção/DPA aprovada.
- [ ] Agentes têm schemas, policies, limites, idempotência, sandbox e aprovação.
- [ ] Evals e rollback impedem regressão de prompt/modelo.

## Decisões que dependem de requisitos do negócio

Antes da Fase 2, registrar em ADR: volume de tenants/usuários/execuções, países e
residência de dados, classes de documento, prazos legais de retenção, sistemas que
os agentes poderão alterar, tolerância de custo/latência, necessidade de aprovação
dupla e RPO/RTO contratual. Essas respostas determinam topologia e controles; não
devem ser inferidas do código.
