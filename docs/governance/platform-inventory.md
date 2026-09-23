# Inventário da plataforma

Última atualização: 25/08/2026.

## Azure

| Item | Valor |
|---|---|
| Assinatura | `Azure subscription 1` |
| Grupo de recursos | `rg-e3i-obrigacoes` |
| Static Web App | `e3i-obrigacoes` |
| Plano | Free |
| Região do recurso | Central US |
| Host de produção | `black-mud-078f1a310.7.azurestaticapps.net` |
| Origem de deploy | GitHub Actions do repositório `e3isolucoes/portal-e3i-solucoes` |
| Branch de produção | `main` no workflow; recurso sem vínculo automático (`provider: None`) |

O recurso não possui integração de repositório criada pelo portal. Por isso, a
propriedade de branch do recurso permanece vazia e o evento `push` em `main` do
workflow determina o deploy de produção. O único pipeline autorizado é
`.github/workflows/azure-static-web-apps.yml`, evitando deploys duplicados e
divergência entre configurações.

## Supabase

| Item | Valor |
|---|---|
| Projeto | `fsyginnpvonruifetjjs` |
| Uso | PostgreSQL, Auth, RLS e Storage |
| Plano atual | Free |

As configurações Azure `SUPABASE_URL` e `SUPABASE_ANON_KEY` contêm somente o
endpoint e a chave publicável usados para validar a sessão. A chave
`service_role` e a senha do banco não são necessárias no Static Web App.

Durante a validação AWS, o Supabase continua como emissor de identidade e como
backend de produção. A migração do plano de dados ainda não representa corte.

## AWS — staging do Painel de Obrigações

| Item | Valor |
|---|---|
| Conta | `181215701228` |
| Região | `sa-east-1` |
| Stack | `e3i-staging-painel-obrigacoes` |
| DynamoDB | `e3i-staging-painel-obrigacoes` |
| Lambda | `e3i-staging-painel-obrigacoes-api` |
| Bucket | `e3i-staging-painel-obrigacoes-files-181215701228` |
| API | `https://oezgdex1li.execute-api.sa-east-1.amazonaws.com` |
| Função de deploy | `e3i-staging-deployer` |

O DynamoDB usa partições por ferramenta, ambiente e empresa. O bucket é privado,
criptografado e versionado. O navegador acessa dados somente pela API autenticada;
credenciais AWS nunca são distribuídas ao frontend.

## Segredos e responsáveis

| Segredo/configuração | Local autorizado | Rotação |
|---|---|---|
| Token de deploy Azure | GitHub Actions secret `AZURE_STATIC_WEB_APPS_API_TOKEN` | após incidente ou troca de responsável |
| Senha do banco Supabase | cofre do provedor e backup local DPAPI | após incidente ou exposição |
| Supabase `service_role` | cofre do provedor e backup local DPAPI | após incidente ou exposição |
| Chave de IA opcional | Azure Static Web App application setting | conforme política do provedor |
| Sessão AWS CLI | login temporário + MFA, sem access key persistente | a cada sessão |
| Função AWS de deploy | perfil local que assume `e3i-staging-deployer` | revisar trimestralmente |

Nunca registrar valores de segredos neste inventário, em issues, logs ou
documentos de recuperação.

## Evidência inicial

- workflow do PR 97: validação e deploy aprovados;
- preview Azure: `black-mud-078f1a310-97.centralus.7.azurestaticapps.net`;
- frontend: HTTP 200;
- API sem bearer: HTTP 401, comprovando autenticação ativa e acesso negado por
  padrão.
- PR 103: preview AWS validado com autenticação, 179 ocorrências, CRUD completo,
  comprovante, exclusão sem órfão e CI aprovado.
