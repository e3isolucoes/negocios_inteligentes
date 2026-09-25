# Portal auth compatibility

Esta pasta concentra patches do Portal E3I mantidos no repositório canônico `e3isolucoes/negocios_inteligentes`.

## Sessão anônima

`patch-session-probe.cjs` ajusta somente `GET /api/auth/session` no bundle do Portal. Quando essa rota encontra ausência de sessão e responderia `401`, o patch normaliza o probe para:

```json
{
  "authenticated": false,
  "user": null,
  "session": null
}
```

Rotas protegidas continuam preservando `401/403`.

Uso em imagem do Portal:

```dockerfile
COPY portal-admin/patch-session-probe.cjs /tmp/patch-session-probe.cjs
RUN node /tmp/patch-session-probe.cjs
```

Teste local:

```bash
node portal-admin/test-session-probe.cjs
```


## Deploy Azure via OIDC

O workflow `.github/workflows/portal-containerapp-deploy.yml` usa OpenID Connect (OIDC) e não depende de `AZURE_CREDENTIALS` nem de client secret permanente.

Cadastre no environment GitHub `portal-test` as variáveis:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

No Microsoft Entra ID, a App Registration/Managed Identity usada pelo GitHub deve possuir uma credencial federada com:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Subject: `repo:e3isolucoes/negocios_inteligentes:environment:portal-test`

A identidade precisa ter permissão para executar build no ACR `acre3i431811` e atualizar o Container App `e3i-portal-test` no resource group `rg-e3i-portal-test`.


## Ponte de autenticação das ferramentas

`client-tool-auth.js` mantém `/api/client-tools` e `/api/admin/access` no mesmo transporte de autenticação que validou `/api/auth/session`.

Isso evita falso bloqueio de ferramenta quando o Portal autenticou por cookie mas a aplicação tenta reutilizar um bearer antigo. A ponte não concede ferramentas e não altera autorização no servidor; ela apenas preserva corretamente a sessão já autenticada.

O build injeta `/client-tool-auth.js` antes do bundle principal do Portal e valida que o script está presente uma única vez.


## Promoção segura de revisões

O Container App `e3i-portal-test` opera em modo de múltiplas revisões. Nesse modo, criar uma nova revisão não significa que ela recebe tráfego automaticamente.

O workflow segue a sequência:

1. publica uma imagem imutável no ACR;
2. cria a revisão candidata;
3. espera `latestReadyRevisionName` coincidir com a revisão candidata;
4. testa diretamente o FQDN da revisão candidata;
5. somente após o smoke test, promove essa revisão para 100% do tráfego;
6. valida novamente o FQDN principal do Container App;
7. valida o domínio público `portal.e3isolucoes.com.br`.

Esse fluxo evita validar acidentalmente uma revisão antiga e evita promover uma revisão que ainda não passou pelo contrato de sessão anônima.


## Administração de acessos no Portal

A imagem do Portal inclui a página protegida:

`/admin-central.html`

O acesso à página exige sessão válida e autorização administrativa no backend. Usuários não administrativos recebem `403`; a tela não é exposta como arquivo público.

A aba **Ferramentas** usa:

- `GET /api/client-tools` para listar o catálogo e o estado `granted`;
- `PUT /api/admin/organizations/:organizationId/client-tools/:toolId` para conceder acesso;
- `DELETE /api/admin/organizations/:organizationId/client-tools/:toolId` para revogar acesso.

A organização é derivada da sessão autenticada e validada no servidor. O cliente não pode escolher outro tenant por payload.

A página também inclui gestão de usuários da organização, com proteção contra auto-revogação e remoção do último administrador.

O link **Administração** é inserido no próprio Portal somente quando `GET /api/admin/access` retorna `authorized: true`.


## Gestão profissional de empresas e acessos

A Administração Central separa explicitamente três conceitos:

1. **Empresa cadastrada** — registro organizacional disponível no Portal.
2. **Vínculo do usuário** — membership que permite ao usuário pertencer à empresa.
3. **Empresa ativa** — contexto efetivamente usado pelo Portal para resolver `/api/client-tools` e validar o acesso às ferramentas.

Um usuário pode possuir vínculo com mais de uma empresa, mas apenas uma empresa é o contexto ativo por vez.

A tela `/admin-central.html` possui a área **Empresas**, onde o administrador raiz pode:

- cadastrar e editar empresas;
- selecionar a empresa que está sendo administrada;
- tornar uma empresa o contexto ativo da sessão;
- visualizar quantidade de usuários e administradores vinculados;
- vincular usuários à empresa;
- definir uma empresa vinculada como empresa ativa de um usuário.

Ao alterar a empresa ativa, o overlay sincroniza o dataset persistido e as estruturas de usuário/sessão em memória do Portal. Isso evita o falso cenário em que a Administração mostra um vínculo válido, mas `/api/client-tools` continua avaliando a empresa anterior.

Administradores delegados permanecem limitados às empresas às quais possuem membership ativo. Cadastro de empresas e gestão cross-tenant continuam restritos ao administrador raiz.

### Sequência recomendada para liberar uma ferramenta

1. Cadastre ou selecione a empresa em **Empresas**.
2. Vincule o usuário à empresa em **Usuários**.
3. Quando necessário, use **Definir como ativa** para alinhar o contexto do usuário.
4. Para administrar ferramentas, torne a empresa selecionada **ativa para a sessão administrativa**.
5. Em **Ferramentas**, conceda o acesso.
6. Volte ao Portal e atualize o catálogo.

Essa sequência mantém o grant da ferramenta e o contexto empresarial consistentes.
