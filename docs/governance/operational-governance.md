# Governança operacional

## Ambientes e mudanças

- `main` representa produção e só recebe mudanças por pull request.
- Cada pull request gera preview no Azure e deve passar por testes, sintaxe,
  auditoria de dependências e verificação de segredos.
- Produção usa o ambiente GitHub `production`, com aprovação obrigatória do
  responsável designado.
- Mudanças em autenticação, RLS, Storage ou migração SQL exigem revisão adicional
  e teste explícito de isolamento entre duas empresas.
- O rollback padrão é redeploy do último commit saudável; migrações destrutivas
  não são permitidas sem backup verificado e plano de reversão.

## Acessos

- Manter no máximo duas pessoas com privilégios Owner no Supabase e GitHub.
- Administradores do sistema usam contas individuais; contas compartilhadas são
  proibidas.
- Revisar acessos trimestralmente e imediatamente após desligamento ou troca de
  função.
- MFA é obrigatório para GitHub, Azure, Supabase, Cloudflare e e-mail operacional.
- `service_role`, senha do banco e tokens de deploy ficam somente em secrets do
  provedor ou proteção local DPAPI; nunca no frontend.

## Capacidade e custo

Baseline de 23/08/2026: banco 15 MB, Storage 17,5 MB, sete usuários.

| Recurso | Alerta | Crítico | Limite gratuito |
|---|---:|---:|---:|
| Banco Supabase | 350 MB | 425 MB | 500 MB |
| Storage Supabase | 700 MB | 850 MB | 1 GB |
| Egress Supabase | 3,5 GB | 4,5 GB | 5 GB não armazenado em cache |
| Aplicação Azure | 175 MB | 225 MB | 250 MB |
| Tráfego Azure | 70 GB | 90 GB | 100 GB/mês |

Revisar mensalmente o painel de uso. Ao atingir alerta, abrir decisão de capacidade;
ao atingir crítico, congelar funcionalidades que aumentem consumo até expansão.

### Plano de dados AWS em validação

| Recurso | Alerta | Crítico | Ação |
|---|---:|---:|---|
| DynamoDB `ReadThrottleEvents` | 1 em 5 min | 3 em 5 min | reduzir polling e revisar RCU |
| DynamoDB `WriteThrottleEvents` | 1 em 5 min | 3 em 5 min | revisar concorrência e WCU |
| Lambda `Errors` | 1 em 5 min | 3 em 5 min | interromper corte e consultar logs sem payloads |
| Lambda `Throttles` | 1 em 5 min | 3 em 5 min | revisar reserva e limite da API |
| Orçamento AWS | 80% previsto | 100% realizado | congelar expansão e revisar consumo |

Produção deve usar proteção contra exclusão e PITR no DynamoDB. Staging mantém
esses recursos desativados quando necessário para controlar custo, mas exige
exportação lógica antes de testes destrutivos. O bucket S3 permanece privado,
versionado e com versões antigas retidas por 90 dias.

## Segurança e LGPD

- Classificar comprovantes e comentários como dados confidenciais de clientes.
- Coletar apenas informações necessárias à obrigação fiscal.
- Não enviar comprovantes, e-mails ou identificadores a modelos de IA sem base
  legal, finalidade documentada e minimização.
- Incidentes com possível exposição devem ser registrados com data, escopo,
  titulares afetados, contenção e decisão de comunicação.
- Logs não devem conter tokens, senhas, conteúdo integral de documentos ou chaves.

## Rotinas

- Semanal: revisar falhas de deploy e alertas de segurança.
- Mensal: conferir quotas, custos, dependências, orçamento AWS e executar backup.
- Trimestral: revisar acessos, restaurar um backup em ambiente isolado e revisar
  este documento.
- Antes de release relevante: backup completo e smoke test no preview.
