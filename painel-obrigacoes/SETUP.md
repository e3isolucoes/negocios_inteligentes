# Como publicar o Painel de Obrigações — passo a passo

Este guia parte da pasta `painel-obrigacoes` (não é mais um único arquivo
HTML — veja o aviso mais abaixo sobre o que mudou). Leva uns 25-30 minutos
na primeira vez; depois disso, publicar uma alteração leva menos de um
minuto.

> **O que mudou desde a última versão:** antes era um arquivo HTML único
> que você editava e publicava manualmente no provedor estático anterior. Agora o
> painel é uma pastinha de arquivos, guardada no GitHub, e a publicação é
> automática a cada alteração — você não precisa mais arrastar nada
> manualmente. Isso também corrige um problema do modelo antigo: antes,
> se duas pessoas mexessem no painel ao mesmo tempo, uma podia sobrescrever
> sem querer o que a outra tinha acabado de fazer. Agora isso não acontece
> mais.

---

## 1. Escolher o projeto no Supabase

> **Este painel já está em produção?** Continue usando o projeto Supabase
> atual. Um novo deploy do HTML/CSS/JavaScript não exige criar outro projeto,
> não troca o banco conectado e não apaga as informações existentes. As etapas
> de criação abaixo são exclusivamente para uma instalação nova, sem banco.

### Somente para uma instalação nova

1. Acesse **https://supabase.com** e crie uma conta (dá para usar o e-mail
   do Google).
2. Clique em **New Project**.
3. Dê um nome (ex.: `painel-gra`), crie uma senha de banco de dados forte
   (guarde essa senha — não é a mesma senha que a equipe vai usar para
   logar), escolha a região mais próxima (South America, se disponível) e
   clique em **Create new project**. Leva 1–2 minutos para provisionar.

## 2. Criar as tabelas do painel

Se o projeto atual já contém as tabelas e informações do painel, **não crie
outro projeto**. Para apenas publicar esta correção de CSP, também não é
necessário executar nenhum SQL: basta fazer o deploy do repositório mantendo o
`js/config.js` atual.

1. No menu lateral do seu projeto, clique em **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo `sql/schema.sql` (está dentro da pasta do projeto), copie
   o conteúdo inteiro e cole no SQL Editor.
4. Clique em **Run**. Deve aparecer "Success. No rows returned".

Isso cria quatro tabelas — obrigações, conclusões, empresas e perfis de
acesso — cada uma protegida por regras de segurança (RLS) que garantem que
**só usuários autenticados** conseguem ler ou gravar, e que só
administradores podem cadastrar/editar/excluir obrigações (qualquer pessoa
da equipe pode marcar conclusões). Também cria as tabelas de comentários,
feriados e histórico de alterações, e o espaço de armazenamento
(bucket `comprovantes`) usado para anexar comprovantes às conclusões.

### Correção de importação em um banco já existente

Se o console mostrar `404` para `rpc/import_obligations` seguido de `403`
com `new row violates row-level security policy`, ou o erro `23514` mencionar
`frequency_fields_check` ao salvar uma obrigação diária, o site novo foi
publicado, mas a atualização correspondente ainda não foi aplicada ao banco.
No **SQL Editor** do mesmo projeto Supabase, execute somente o arquivo
`sql/migrations/20260813_fix_import_obligations.sql`. Ele não apaga nem altera
obrigações existentes: instala a importação transacional, recompõe a policy de
administrador, atualiza as restrições de frequência e solicita ao PostgREST que
atualize o cache da RPC imediatamente.

> **Se precisar rodar este script de novo no mesmo projeto** (por exemplo,
> para atualizar para uma versão mais nova do painel), pode colar e rodar
> o arquivo inteiro de novo sem problema — o script foi escrito para ser
> seguro nesse caso (não trava com erros de "já existe"). Isso também vale
> quando uma nova versão do painel adiciona uma coluna nova a uma tabela
> existente (por exemplo, a versão que vincula o campo "Responsável" a uma
> conta da equipe) — rodar o script de novo só adiciona o que está
> faltando, sem apagar nem alterar os dados que você já tem cadastrados.

## 3. Conferir que o cadastro está habilitado

O painel agora cria contas novas pela própria interface (Gerenciar →
Equipe → "Salvar"), e essa tela depende de uma configuração do
Supabase estar **ligada**:

1. Vá em **Authentication → Sign In / Providers** (ou **Auth Settings**,
   dependendo da versão do painel).
2. Confirme que **"Allow new users to sign up"** está **habilitado**
   (é o padrão de um projeto novo — normalmente não precisa mexer em nada
   aqui).

> **Por que isso é seguro mesmo com o cadastro "aberto":** a tela de login
> do painel não tem nenhum formulário público de "criar conta" — só quem
> tem acesso a Gerenciar → Equipe (um admin já autenticado) consegue criar
> uma conta pela interface. Tecnicamente, alguém com bastante conhecimento
> técnico e a chave pública do seu projeto (que já fica exposta no
> JavaScript do painel, por design — veja "Papéis de acesso (RLS)" no
> README) poderia chamar a API do Supabase diretamente e criar uma conta
> "membro" por fora da tela. Isso não é diferente, em termos de risco, de
> qualquer outro sistema que valida permissões por RLS em vez de por
> segredo de chave: quem se cadastrar assim só ganha uma conta **membro**
> comum (leitura + marcar conclusões, nunca admin — a promoção para admin
> é bloqueada para a própria pessoa por um gatilho no banco), e aparece na
> lista de Gerenciar → Equipe para qualquer admin notar e remover pelo
> painel do Supabase (Authentication → Users → excluir). Se preferir a
> postura mais restritiva de antes (cadastro só manual, pelo painel do
> Supabase), desligue esta opção — a tela de "Criar conta" do painel para
> de funcionar e mostra um aviso explicando isso, mas o resto do sistema
> continua igual.

## 4. Criar as contas da equipe

**Sua própria conta (a primeira de todas) ainda precisa ser criada pelo
painel do Supabase**, porque a tela "Criar conta" do painel só existe
dentro de Gerenciar → Equipe — e essa área só abre para quem já está
logado como admin. É um problema só na primeira vez:

1. No Supabase, vá em **Authentication → Users → Add user → Create new user**.
2. Preencha seu e-mail e uma senha.
3. Marque **"Auto Confirm User"** (ou "Email confirmed") — sem isso você
   não consegue logar até confirmar o e-mail.
4. Clique em **Create user**.

Isso cria sua conta com o papel **membro** por padrão. O próximo passo
mostra como se promover a administrador. **A partir daí**, todo o resto da
equipe pode ser cadastrado direto na tela do painel, sem precisar mais
voltar ao Supabase:

1. Faça login no painel e vá em **Gerenciar → Equipe**.
2. Preencha nome, e-mail e uma senha temporária (ou clique em "Gerar").
3. Escolha o papel (Membro ou Admin).
4. Clique em **"Salvar"**.
5. Anote a senha mostrada na caixa verde — ela não aparece de novo — e
   repasse para a pessoa por um canal seguro (ela pode trocar depois).

Se o projeto tiver a confirmação de e-mail ligada (padrão), a pessoa
recebe um e-mail para confirmar antes do primeiro login. Se preferir pular
isso para agilizar, você (como admin) pode confirmar manualmente pelo
painel do Supabase: **Authentication → Users → (usuário) → Confirm email**.
O jeito antigo (Authentication → Users → Add user) também continua
funcionando a qualquer momento, se preferir.

> Se alguém esquecer a senha, você (como administrador) pode redefinir pelo
> painel do Supabase: **Authentication → Users → (usuário) → Reset password**.

## 5. Promover você mesmo (primeiro administrador)

Por segurança, o **primeiro** administrador do projeto precisa ser
promovido pelo SQL Editor do Supabase — depois disso, promover ou
rebaixar qualquer outra pessoa já pode ser feito direto na tela do painel
(aba **Gerenciar → Equipe**), sem precisar mais mexer em SQL.

1. Volte no **SQL Editor → New query**.
2. Cole (trocando pelo e-mail da pessoa):

```sql
update profiles set role = 'admin' where email = 'seu-email@empresa.com.br';
```

3. Clique em **Run**.

Para conferir quem é admin hoje, rode:

```sql
select email, role from profiles order by role, email;
```

A partir daqui, para promover mais alguém a administrador (ou rebaixar
alguém de volta a membro), basta logar no painel como administrador, ir em
**Gerenciar → Equipe** e clicar em "Tornar admin" / "Tornar membro" ao
lado do nome da pessoa. Não precisa mais voltar ao SQL Editor para isso.

## 6. Conectar o projeto ao seu Supabase

1. No Supabase, vá em **Project Settings → API**.
2. Copie o valor de **Project URL**.
3. Copie o valor de **anon public** (também chamada de "publishable key").
4. Abra o arquivo `js/config.js` (dentro da pasta do projeto) num editor de
   texto (Bloco de Notas, VS Code, ou até o Notepad do Windows serve).
5. Você vai ver estas duas linhas:

```js
export const SUPABASE_URL = 'COLE_AQUI_A_URL_DO_SEU_PROJETO_SUPABASE';
export const SUPABASE_ANON_KEY = 'COLE_AQUI_A_CHAVE_PUBLICA_ANON';
```

6. Substitua pelos valores copiados, mantendo as aspas. Fica assim
   (exemplo):

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

7. Salve o arquivo. **Esse é o único arquivo que você precisa editar** —
   todo o resto da pasta pode ficar como está.

> **A chave "anon public" pode ficar exposta no código** — isso é
> proposital e seguro por design do Supabase: quem protege os dados de
> verdade é a regra de segurança que você criou no passo 2 (só usuário
> logado lê/grava, e só admin cadastra/edita), não o sigilo dessa chave.
> Nunca cole a "service_role key" (essa sim é secreta) em nenhum arquivo
> deste projeto.

## 7. Repositório GitHub

O painel faz parte do monorepositório privado
`e3isolucoes/portal-e3i-solucoes`, dentro de `painel-obrigacoes/`. Não crie um
segundo repositório e não copie os workflows desta pasta: o GitHub executa os
pipelines canônicos que ficam em `/.github/workflows/` na raiz do
monorepositório.

A branch de produção é `main`. Alterações devem entrar por pull request para
que os testes, o preview Azure e as proteções de ambiente sejam aplicados antes
do merge. Confirme em **Settings → Actions → General** que GitHub Actions está
habilitado e em **Settings → Environments** que existem os ambientes
`preview`, `production` e `aws-staging`. O ambiente `aws-staging` deve aceitar
deploy somente de `main`; produção deve manter as aprovações exigidas pela
organização.

## 8. Publicar no Azure Static Web Apps

### Criar e conectar o recurso

1. No Portal Azure, clique em **Criar um recurso → Static Web App**.
2. Escolha a assinatura, o grupo de recursos e um nome, e selecione uma região próxima para as Azure Functions.
3. Crie o recurso sem integração automática de repositório. A branch de produção
   é `main` e o único pipeline autorizado é
   `.github/workflows/azure-static-web-apps.yml`; não permita que o portal crie
   um segundo workflow.
4. Em **Build details**, escolha **Custom** e informe exatamente:
   - **App location:** `/painel-obrigacoes`
   - **API location:** `painel-obrigacoes/api`
   - **Output location:** deixe vazio
5. Crie o recurso. Copie o token em **Manage deployment token** e cadastre-o no
   ambiente `production` do GitHub, em **Settings → Environments → production →
   Environment secrets**, com o nome `AZURE_STATIC_WEB_APPS_API_TOKEN`. Cadastre
   o mesmo nome no ambiente `preview` para habilitar previews de pull requests.
   O workflow `.github/workflows/azure-static-web-apps.yml` usa esse secret, não
   executa build da interface e publica `painel-obrigacoes/` junto da API.
6. Cadastre o token de implantação no secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN`, faça merge em `main` e acompanhe
   **GitHub → Actions → Azure Static Web Apps CI/CD**. Ao terminar, abra a URL
   exibida em **Overview**, no formato
   `https://<nome-gerado>.azurestaticapps.net`. Pull requests recebem um ambiente
   temporário e ele é removido automaticamente ao fechar o PR.

A configuração `staticwebapp.config.json` fornece fallback para `index.html`, exclui API e arquivos estáticos do fallback e aplica CSP e demais cabeçalhos de segurança. A Azure Static Web Apps é a única hospedagem configurada para o frontend.

### Acesso sem nova senha a partir do Portal E3I

Ao abrir a ferramenta em um `iframe`, o Portal E3I pode reutilizar a sessão
Supabase já autenticada. A ferramenta envia ao frame pai:

```js
{ type: 'E3I_TOOL_AUTH_REQUEST' }
```

O portal deve responder **somente** quando `event.origin` for a origem publicada
da ferramenta e `event.source` for o `iframe.contentWindow` correspondente:

```js
iframe.contentWindow.postMessage({
  type: 'E3I_TOOL_AUTH_SESSION',
  session: {
    access_token: session.access_token,
    // Opcional: o portal pode entregar somente a sessão temporária da
    // ferramenta; a senha do portal nunca é enviada ao painel.
    refresh_token: session.refresh_token,
  },
}, TOOL_ORIGIN);
```

A ferramenta aceita a resposta exclusivamente de
`https://portal.e3isolucoes.com.br`, restaura a sessão no seu próprio domínio e
mantém as permissões do perfil (`active`, papel, empresa e módulos) como fonte de
autorização. O `refresh_token` é opcional: sem ele, a sessão vale até a expiração
do token temporário e um novo acesso deve ser solicitado ao portal. Tokens não
devem ser incluídos em query strings ou fragmentos de
URL. Se o portal estiver em outro domínio autorizado, altere `portalOrigin` em
`js/runtime-config.js` e o `frame-ancestors` de `staticwebapp.config.json` em
conjunto.

### Configurar os segredos da Function

No recurso Static Web App, abra **Settings → Environment variables** (em alguns layouts, **Configuration**) e adicione para o ambiente de produção:

- `AWS_API_BASE_URL`: URL pública do API Gateway AWS (sem `/v1`), usada pela
  Function para validar identidade e membership em `GET /v1/me`;
- `ALLOWED_ORIGINS`: origens permitidas, separadas por vírgula;
- `OPENAI_API_KEY`: chave secreta da API OpenAI;
- `ENABLE_SUPABASE_AUTH_FALLBACK`: deixe ausente ou `false`; use `true` somente
  durante rollback explícito, junto de `SUPABASE_URL` e
  `SUPABASE_ANON_KEY`. Nesse modo temporário, a associação ainda é confirmada
  pela RLS de `profiles` antes de qualquer chamada ao provedor de IA;
- `SUPABASE_URL` e `SUPABASE_ANON_KEY`: configure apenas no rollback acima. A
  chave deve ser pública (`anon`/publishable); nunca use `service_role`;
- `OPENAI_MODEL`: modelo permitido pela conta, por exemplo `gpt-5-mini`.

Salve e aguarde a reinicialização. Esses valores pertencem exclusivamente aos
**Azure Application Settings** do backend e **não** devem ser adicionados ao
GitHub, `js/config.js` ou a qualquer arquivo servido ao navegador. Se a API for
posteriormente vinculada a uma Function App separada, cadastre os mesmos nomes
em **Function App → Settings → Environment variables**. Sem `OPENAI_API_KEY`, o
endpoint retorna o modelo operacional seguro como fallback.

### Configurar URLs de autenticação no Supabase

Com a URL Azure em mãos, abra **Supabase → Authentication → URL Configuration**:

1. Defina **Site URL** como `https://<nome-gerado>.azurestaticapps.net`.
2. Adicione `https://<nome-gerado>.azurestaticapps.net/**` em **Redirect URLs** para permitir o caminho usado na recuperação de senha.
3. Ao conectar um domínio em **Azure → Custom domains**, valide DNS e HTTPS, depois adicione `https://painel.suaempresa.com.br/**` às **Redirect URLs**.
4. Quando o domínio personalizado for oficial, altere **Site URL** para ele. Mantenha a URL `azurestaticapps.net` na allowlist enquanto ela ainda for usada por testes ou suporte.

## 9. Validação no domínio Azure

Execute esta lista no endereço de produção, em uma janela anônima e também no navegador normalmente usado pela equipe:

- [ ] **Login:** entrar com membro e administrador, confirmar as permissões e sair; tentativas inválidas não podem abrir o painel.
- [ ] **Portal E3I:** entrar somente no portal, abrir a ferramenta concedida e confirmar que ela carrega sem pedir a senha novamente; mensagens de outra origem devem ser ignoradas.
- [ ] **Recuperação de senha:** solicitar o e-mail, abrir o link recebido, definir nova senha e confirmar que o retorno permanece no domínio Azure.
- [ ] **Painel:** carregar empresas e obrigações, navegar pelas abas e confirmar ausência de erros de CSP/rede no DevTools.
- [ ] **Sugestões:** usar **Sugerir checklist** e confirmar no Network que `POST /api/checklist-suggestions` responde sem qualquer chave no request ou nos arquivos JavaScript. Verificar também o fallback sem a chave em um ambiente de preview.
- [ ] **PWA:** no DevTools → Application, confirmar manifesto, ícones e opção de instalação no domínio HTTPS.
- [ ] **Service worker:** confirmar que `sw.js` está ativado e que recarregar a página não retorna `index.html` no lugar de JS, manifesto, ícones ou chamadas `/api/*`. Após um deploy, usar **Update** e validar a versão nova.

Registre a URL, data, navegador, usuário/papel de teste e evidências de cada item. Essas verificações dependem do recurso Azure, DNS, secrets e usuários Supabase reais; os testes automatizados locais não as substituem.

## 10. Segurança — o que isso garante e o que ainda depende de você

O que você ganha com essa estrutura: ninguém acessa nem edita o painel sem
e-mail e senha válidos; a senha nunca fica visível em lugar nenhum (o
Supabase cuida da criptografia); só administradores conseguem
cadastrar/editar/excluir obrigações e empresas, e só administradores
podem promover ou rebaixar outras contas (garantido pelo próprio banco de
dados, não só pela tela); e você controla exatamente quem tem conta e quem
é administrador — tudo isso direto pela aba Gerenciar → Equipe, depois do
primeiro admin criado no passo 5.

O que continua sendo sua responsabilidade: escolher senhas fortes para a
equipe, desativar o acesso de quem sair do time (**Authentication → Users
→ excluir/desativar**), não compartilhar a senha do banco de dados
(diferente da senha de login da equipe) com ninguém, manter o repositório
do GitHub como **privado**, e — já que "Allow new users to sign up" fica
ligado para a tela de "Criar conta" funcionar (passo 3) — dar uma
olhada de vez em quando em Gerenciar → Equipe para conferir que não
apareceu nenhuma conta que você não reconhece (ver a explicação do
trade-off no passo 3).

## 11. Backup dos dados (recomendado, gratuito)

De vez em quando (por exemplo, uma vez por mês), vale exportar uma cópia
dos dados, por segurança:

1. No Supabase, vá em **Table Editor**.
2. Para cada tabela (`obligations`, `completions`, `companies`,
   `profiles`), clique nos três pontinhos → **Export data → Export to
   CSV**, e guarde os arquivos baixados numa pasta seguro (ex.: Google
   Drive da empresa).

Isso não custa nada e não depende de nenhuma ferramenta paga — é só um
hábito recomendado para não depender só do que está online.

## 12. Alertas diários por e-mail

Após o cutover, os alertas são executados por **EventBridge Scheduler + Lambda**
no stack SAM de `aws/template.yaml`. A Lambda lê partições isoladas do DynamoDB
e envia por Amazon SES com uma role de execução temporária; produção não usa
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, credenciais AWS no GitHub nem chave
da Resend.

O schedule é criado desabilitado. Valide primeiro uma invocação controlada e a
identidade/domínio SES conforme `aws/README.md`; só então altere
`NotificationScheduleState` para `ENABLED` por processo de deploy aprovado.
A validação do serviço de notificações faz parte do pipeline AWS.

## Onde pedir ajuda

Se algo neste guia não bater com o que você está vendo na tela do
Supabase, Azure ou GitHub, é provável que a interface deles tenha mudado
de layout desde que este guia foi escrito — a lógica (criar tabela,
promover admin, conectar GitHub) continua a mesma, só os botões podem
estar em lugares um pouco diferentes.
