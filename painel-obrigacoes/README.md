# Gestão de Atividades Administrativas — README técnico

O produto mantém integralmente o fluxo e os acessos do antigo Painel de
Obrigações e passa a atender também a gestão administrativa da empresa. As
obrigações existentes continuam sendo atividades válidas, no mesmo banco e
com os mesmos responsáveis, históricos, evidências e permissões. Novos
registros podem usar as áreas Administrativo, Financeiro, Pessoas e RH,
Comercial, Operações, Compras e fornecedores, Tecnologia e Projetos; a Central
de Gestão consolida todas elas sem retirar os recortes Fiscal, Contábil e de
Controladoria já utilizados pela equipe.

Este documento é para quem vai mexer no código. Para o passo a passo de
publicação em linguagem simples, veja `SETUP.md`.

Para a avaliação priorizada de arquitetura, segurança, DevOps, resiliência e
evolução do motor de processos/agentes, veja
[`docs/architecture/production-readiness-assessment.md`](docs/architecture/production-readiness-assessment.md).

## Visão geral da arquitetura

```
painel-obrigacoes/
├── index.html              shell HTML (login + <div id="app">)
├── manifest.json            manifesto PWA (instalar no celular/desktop)
├── sw.js                     service worker mínimo (só para instalabilidade — não cacheia nada)
├── icons/                    ícones do PWA (192px e 512px)
├── staticwebapp.config.json  fallback de SPA, cache e cabeçalhos de segurança da Azure
├── package.json              comandos e dependências auxiliares (o painel em si não usa)
├── api/
│   ├── package.json          runtime Node da Azure Functions
│   └── checklist-suggestions.js  função HTTP server-side para sugestões
├── css/
│   └── styles.css          identidade visual (preservada do painel original)
├── js/
│   ├── config.js            ← único arquivo que você edita para publicar
│   ├── supabaseClient.js    cria o cliente Supabase a partir do config.js
│   ├── constants.js         categorias, prioridades, rótulos de frequência, nomes de mês
│   ├── dateUtils.js         cálculo de ocorrências, prazos, status, ajuste de dia útil (puro, sem DOM)
│   ├── state.js             estado em memória da sessão atual
│   ├── data.js               ações de negócio (marcar concluído, salvar, excluir…)
│   ├── csv.js                 leitura, validação, match aproximado de responsável/empresa e modelo do CSV de importação em massa
│   ├── ocr.js                  leitura de competência do comprovante (imagem via Tesseract.js, PDF via pdf.js + fallback OCR)
│   ├── render.js             monta a tela e distribui os cliques (delegação de eventos)
│   ├── app.js                 ponto de entrada: autenticação, boot, registro do service worker
│   ├── api/
│   │   ├── auth.js           login/logout/perfil, envio e conclusão de redefinição de senha
│   │   ├── obligations.js    CRUD de obrigações (inclui inserção em massa)
│   │   ├── completions.js    marcar/desfazer conclusões, anexar comprovante
│   │   ├── companies.js      empresas
│   │   ├── profiles.js       equipe (listar contas, editar nome/papel, revogar/reativar acesso)
│   │   ├── adminUsers.js      cria a conta de autenticação de alguém novo (auth.signUp em instância Supabase separada)
│   │   ├── comments.js       comentários por obrigação
│   │   ├── checklist.js      itens de checklist por obrigação (marcar/reiniciar via função do banco)
│   │   ├── auditLog.js       trilha de auditoria (somente leitura)
│   │   ├── holidays.js       feriados (cadastro manual + importação via BrasilAPI)
│   │   ├── obligationRules.js  CRUD do catálogo de regras/modelos de mercado
│   │   ├── occurrenceOverrides.js  ajuste pontual de data de uma ocorrência (sem alterar a regra)
│   │   ├── taxRegimes.js      catálogo de regimes tributários e seus vínculos com regras/empresas
│   │   └── storage.js        upload e link assinado dos comprovantes (Supabase Storage)
│   └── ui/
│       ├── login.js           tela de login + tela de definir nova senha (link de redefinição)
│       ├── toolbar.js         abas + filtros
│       ├── board.js           painel (cartões agrupados por status; também usado pela aba "Minhas obrigações")
│       ├── manage.js          aba "Gerenciar": orquestra as 8 sub-abas abaixo
│       ├── manageObligations.js  sub-aba Obrigações (lista administrativa)
│       ├── manageCompanies.js    sub-aba Empresas (cadastrar/renomear/excluir)
│       ├── manageTeam.js         sub-aba Equipe (criar/editar conta, revogar/reativar acesso)
│       ├── manageImport.js       sub-aba Importar CSV (cadastro em massa)
│       ├── manageRules.js        sub-aba Regras (catálogo de obrigações de mercado)
│       ├── manageRegimes.js      sub-aba Regimes tributários (catálogo + vínculo com regras/empresas)
│       ├── manageHolidays.js     sub-aba Feriados
│       ├── manageAudit.js        sub-aba Histórico (trilha de auditoria + anomalias sinalizadas)
│       ├── reports.js            aba Relatórios (taxa de cumprimento no prazo)
│       ├── dashboard.js          aba Visão Executiva (KPIs, risco preditivo, concentração, visão tática)
│       ├── modal.js           formulário de nova/editar obrigação + comentários + checklist
│       ├── ruleModal.js       formulário de nova/editar regra do catálogo de mercado
│       ├── applyRuleDialog.js  diálogo para aplicar uma regra a várias empresas de uma vez
│       ├── regimeDialog.js     diálogo de criar/editar um regime tributário
│       ├── regimeRulesDialog.js     diálogo de vincular regras a um regime
│       ├── regimeCompaniesDialog.js diálogo de vincular empresas a um regime
│       ├── overrideDialog.js  diálogo de ajuste pontual de data de uma ocorrência
│       ├── completeDialog.js  diálogo de conclusão: checklist + comprovante obrigatórios
│       ├── toast.js           notificações não-bloqueantes (substitui alert())
│       └── confirmDialog.js   diálogo de confirmação (substitui confirm())
├── scripts/                  utilitários de governança, configuração e lógica compartilhada
├── .github/workflows/
│   ├── azure-static-web-apps.yml  validação e deploy do site/API Azure
│   └── aws-sam-staging.yml        validação e deploy do backend AWS
└── sql/
    └── schema.sql            tabelas, papéis (RLS) — rode isto no Supabase
```

**Sem build, sem bundler.** Tudo é JavaScript nativo com módulos ES6
(`<script type="module">` em `index.html`, `import`/`export` nos arquivos).
A interface é publicada como conteúdo estático no Azure Static Web Apps, sem
comando nem diretório de build. A pasta `api/` é implantada separadamente pelo
mesmo recurso como Azure Functions gerenciada.

> **Atenção ao testar localmente:** módulos ES6 só carregam via `http://`,
> não via `file://` (o navegador bloqueia por CORS quando você dá duplo
> clique no `index.html`). Para testar antes de publicar, rode um servidor
> local simples, por exemplo `npx serve` ou `python3 -m http.server` na
> pasta do projeto, e abra `http://localhost:...` no navegador. Isso é
> diferente do painel antigo (arquivo único), que abria com duplo clique —
> veja o SETUP.md para o fluxo de teste recomendado (deploy de teste do
> Azure Static Web Apps a cada pull request, que já resolve isso automaticamente).

## Por que tabelas relacionais em vez do blob JSON antigo

### Sugestões inteligentes de checklist

Ao editar uma obrigação, **Sugerir checklist** combina os passos de obrigações
semelhantes já cadastradas com um modelo operacional local. No Azure Static Web Apps,
a Azure Function HTTP `api/checklist-suggestions.js` também extrai texto de páginas oficiais
previamente autorizadas (web scraping) e, quando a variável de ambiente
`OPENAI_API_KEY` está configurada, usa um LLM para sintetizar as sugestões. O
modelo pode ser alterado por `OPENAI_MODEL` (padrão: `gpt-5-mini`). As duas
configurações são Application settings da Static Web App; a chave fica somente
no runtime server-side e nunca é enviada ao navegador.
O endpoint exige a sessão Supabase do painel e valida o bearer token no servidor;
configure também `SUPABASE_URL` e `SUPABASE_ANON_KEY` nas Application settings.

Se a rede ou a IA estiver indisponível, o recomendador local continua funcionando.
As sugestões nunca são aplicadas automaticamente: a pessoa seleciona os itens e
recebe um aviso para confirmar procedimentos e prazos nas fontes oficiais.

O painel antigo salvava tudo — todas as obrigações e todas as conclusões —
em **uma única linha** (`board_state`, coluna `data jsonb`). Qualquer
gravação (inclusive "marcar concluído") reescrevia o documento inteiro.
Se duas pessoas salvassem ao mesmo tempo, a segunda gravação simplesmente
sobrescrevia a primeira sem aviso ("last write wins") — dados podiam
desaparecer silenciosamente.

Agora:
- `obligations` — uma linha por obrigação.
- `completions` — uma linha por ocorrência concluída (`obligation_id` +
  `occurrence_date`), com uma restrição `unique` no banco. Se duas pessoas
  clicarem "concluído" na mesma obrigação ao mesmo tempo, a segunda
  gravação falha com um erro de duplicidade — tratado no front-end (ver
  `data.js`, função `doMarkDone`) recarregando os dados em vez de
  corromper nada.
- `companies` — uma linha por empresa.
- `profiles` — uma linha por pessoa, com o papel de acesso (`admin` |
  `membro`).

Cada gravação afeta só a linha correspondente. Não existe mais "documento
inteiro" para conflitar.

## Telas de administração (aba "Gerenciar")

Visível só para quem tem perfil `admin`. Tem oito sub-abas:

- **Obrigações** — cadastrar, editar, excluir (o CRUD original).
- **Empresas** — cadastrar, renomear, excluir; mostra o regime tributário
  de cada empresa e o botão para trazer as obrigações desse regime
  automaticamente (ver seção "Regimes tributários" abaixo). Ao excluir uma
  empresa que tenha obrigações vinculadas, o vínculo simplesmente vira
  nulo nessas obrigações (`on delete set null` no schema) — a obrigação
  não é apagada.
- **Equipe** — cria conta nova, edita nome/papel de quem já tem conta (pelo
  e-mail digitado) e revoga/reativa acesso, além de listar todas as contas
  (`profiles`) (ver seção "Criação de contas de usuário" abaixo).
- **Importar CSV** — cadastro em massa (ver seção própria abaixo).
- **Regras** — catálogo de obrigações-padrão praticadas no mercado (ver seção própria abaixo).
- **Regimes tributários** — catálogo de regimes (Simples, Presumido, Real, MEI) e o vínculo deles com as regras e com as empresas (ver seção própria abaixo).
- **Feriados** — cadastro de feriados usados no ajuste de dia útil, com importação de feriados nacionais de um ano com um clique (ver seção "Feriados e dia útil fiscal" abaixo).
- **Histórico** — trilha de auditoria de obrigações (quem criou/editou/excluiu, quando), com anomalias sinalizadas automaticamente (ver seção "Prioridade, checklist, comentários e histórico" abaixo).

Um administrador pode, inclusive, remover o próprio acesso de admin — a
interface pede confirmação extra nesse caso (`data.js → doChangeRole`),
mas não bloqueia, para não deixar o sistema sem ninguém com esse poder em
caso de erro deliberado. Se isso acontecer sem querer, outro admin resolve
pela tela, ou, na ausência de qualquer admin, pelo SQL Editor do Supabase
(`update profiles set role='admin' where email='...'`).

## Criação de contas de usuário

Em Gerenciar → Equipe, um admin preenche nome, e-mail, senha temporária (ou clica em "Gerar" para uma sugestão) e papel de acesso, e clica em "Salvar". O mesmo formulário serve para os três casos abaixo — quem decide o que acontece é o e-mail digitado:

- **E-mail novo → cria conta.** Comportamento de sempre: cria a conta de autenticação e o perfil, com o papel escolhido.
- **E-mail que já existe na lista abaixo → edita a conta.** Em vez de tentar criar (que falharia, já que e-mail é único no Supabase Auth), o formulário atualiza nome de exibição e papel de acesso dessa conta existente. A senha digitada nesse formulário é ignorada — ver "Redefinir senha" abaixo para trocar a senha de quem já tem conta.
- **Revogar/reativar acesso → botão na lista, não no formulário.** Cada pessoa na lista abaixo do formulário tem um botão "Revogar acesso" (ou "Reativar acesso", se já estiver revogada). Revogar marca a conta como inativa (`profiles.active = false`) sem apagar nada — a pessoa é desconectada e barrada no próximo login/renovação de sessão, com um aviso na tela de login. "Reativar acesso" desfaz isso. Um admin não consegue reverter a própria revogação sozinho (só outro admin) — o mesmo tipo de trava que já existia para autopromoção de papel.
- **Redefinir senha → outro botão na lista.** Não tem como o app trocar a senha de outra pessoa diretamente — só a própria pessoa (logada) ou alguém com a `service_role key` (que este app não tem, ver abaixo) consegue fazer isso no Supabase. "Redefinir senha" manda um e-mail de recuperação (`supabase.auth.resetPasswordForEmail`) para o endereço cadastrado; o destino vem da **Site URL** configurada no Supabase, nunca do endereço local do navegador do administrador. A pessoa clica no link, volta pro painel numa sessão temporária de recuperação, e o app mostra uma tela dedicada ("Definir nova senha", `js/ui/login.js`) em vez de entrar direto — só depois de escolher a senha nova é que ela segue para o painel normalmente. O app detecta essa sessão pelo evento `PASSWORD_RECOVERY` e, para evitar uma corrida durante a inicialização do SDK, também pelo parâmetro `type=recovery` da URL (`js/app.js`).

Detalhes de implementação:

- **Como funciona sem `service_role key`:** o app não tem — e não deveria ter, num projeto 100% client-side — a chave administrativa do Supabase. A criação usa `auth.signUp()` normal (a mesma chamada que um cadastro público usaria), só que numa **instância temporária e separada** do cliente Supabase (`js/api/adminUsers.js`, `persistSession: false`), para não trocar a sessão de quem está logado (o admin) pela da conta recém-criada. Pelo mesmo motivo, revogar acesso não apaga a conta de autenticação nem força logout imediato de uma sessão aberta em outra aba — o bloqueio acontece no próximo login ou na próxima renovação automática de token (ver `js/app.js`), não é um kill-switch instantâneo em nível de rede.
- **O perfil nasce sozinho:** o gatilho `handle_new_user` (já existente no schema, seção 1) cria a linha em `profiles` automaticamente assim que a conta é criada, com papel `membro` e `active = true` por padrão — o app só ajusta nome de exibição e papel logo em seguida.
- **Anote a senha na hora:** ela é mostrada uma única vez, numa caixa verde destacada, com um botão para copiar. Nada fica salvo no painel depois disso — se perder, um admin pode clicar em "Redefinir senha" na lista para mandar um novo link de recuperação para a pessoa.
- **Limitação conhecida — confirmação de e-mail:** se o projeto Supabase tiver a opção "Confirm email" ligada (padrão em projetos novos), a pessoa só consegue entrar depois de clicar no link de confirmação enviado por e-mail — ou um admin confirmar manualmente em Authentication → Users no painel do Supabase. Isso é uma configuração do projeto, fora do alcance do que dá para controlar a partir do navegador.

## Responsável vinculado a uma conta (`responsible_id`)

Cada obrigação tem dois campos relacionados: `responsible` (texto livre,
sempre exibido nos cartões e na lista) e `responsible_id` (referência
opcional para `profiles.id`). No formulário, o campo "Responsável" agora é
um seletor com as contas da equipe, mais uma opção "Outro" que revela um
campo de texto livre — para casos em que o responsável não é usuário do
sistema (ex.: contador terceirizado). Quando alguém da equipe é escolhido,
os dois campos ficam sempre sincronizados (`responsible` reflete o
`display_name` do perfil escolhido); quando é "Outro", só o texto livre é
gravado e `responsible_id` fica nulo.

Esse vínculo é o que permite a aba **"Minhas obrigações"** filtrar de forma
confiável (`ob.responsible_id === STATE.session.id`), em vez de depender de
comparação de texto — que quebraria com qualquer diferença de acentuação,
maiúsculas ou apelido. Obrigações cadastradas antes dessa mudança (ou
importadas com um nome que não bate com nenhuma conta) continuam
funcionando normalmente no restante do painel, só não aparecem em "Minhas
obrigações" até alguém editar e vincular o responsável certo.

**Balanceamento de carga na hora de escolher.** No seletor de "Responsável"
do formulário de obrigação, cada pessoa da equipe aparece com a contagem
atual de pendências ainda não concluídas ao lado do nome (ex.: "Daniela —
4 pendentes") — calculada na hora, a partir das ocorrências ativas
(`js/ui/modal.js`). É só informativo, para apoiar a escolha visualmente;
não distribui nem sugere ninguém automaticamente, a escolha continua
inteiramente manual.

## Importação em massa (CSV)

Em Gerenciar → Importar CSV. Fluxo em duas etapas, pensado para nunca
gravar dado inválido no banco:

1. **Escolher arquivo** → `js/csv.js` lê o CSV (via PapaParse, carregado
   por CDN em `index.html`) e valida cada linha localmente, no navegador,
   sem tocar no banco ainda. O resultado (`STATE.importPreview`) mostra
   quantas linhas estão prontas e quais têm erro, com o motivo específico
   por linha (ex.: `"categoria inválida"`, `"dia inválido (1-31)"`). Nessa
   prévia, se o nome da empresa de uma linha for bem parecido (distância de
   Levenshtein pequena — até 20% do tamanho do nome) com uma empresa já
   cadastrada, mas não idêntico, aparece um aviso amarelo
   (`findSimilarCompanyWarning` em `js/csv.js`) — só avisa, nunca mescla
   nem decide sozinho, porque duas empresas com nomes parecidos podem ser
   entidades legais completamente diferentes; quem confirma a importação
   decide se é duplicata de digitação ou uma empresa realmente diferente.
2. **Confirmar importação** → só as linhas válidas são enviadas. Para cada
   uma: a empresa é criada se ainda não existir (`ensureCompany`, mesmo
   mecanismo do formulário manual); o nome do responsável é comparado com
   `STATE.profiles` por **match aproximado** (`findClosestProfile` em
   `js/csv.js`) — primeiro tenta igualdade exata (ignorando acentos,
   maiúsculas/minúsculas e pontuação); se não achar, calcula a distância de
   Levenshtein contra cada conta e aceita o mais próximo só se a distância
   for pequena o bastante (até 25% do tamanho do nome digitado) **e** não
   houver empate com um segundo candidato igualmente próximo — assim
   `"Daniela"` casa com `"daniela"` cadastrada mesmo com uma letra diferente
   ou sem acento, mas não arrisca vincular à pessoa errada quando o nome é
   ambíguo. Quando não bate com confiança, o responsável fica como texto
   livre (`responsible_id` nulo), do mesmo jeito que "Outro" no formulário
   manual. Todas as linhas são gravadas numa única chamada
   (`createObligationsBulk`), que é tudo-ou-nada no banco — não existe risco
   de metade importar e metade não por causa de uma falha de rede no meio do
   caminho.

Colunas esperadas no CSV (cabeçalho em português, minúsculo — veja
`CSV_COLUMNS` em `js/csv.js`): `nome, categoria, empresa, responsavel,
frequencia, dia, mes, meses, data, observacoes`. `categoria` e
`frequencia` usam as mesmas chaves internas do sistema (`federal`,
`estadual`, `municipal`, `trabalhista`, `societaria` / `diaria`, `mensal`,
`trimestral`, `anual`, `pontual`) — o botão "Baixar modelo CSV" na própria
tela gera um arquivo de exemplo já no formato certo.

Na frequência `diaria`, o painel abre uma nova ocorrência em cada dia do
calendário (inclusive sábados e domingos). A mensal repete no dia configurado
de cada mês, e a anual no mês e dia configurados de cada novo ano. Como cada
dia diário já é uma ocorrência própria, não há ajuste para dia útil nessa
frequência.

## Regras de obrigações (catálogo de mercado)

Gerenciar → Regras é um catálogo de obrigações-padrão (`obligation_rules`), mantido pela **gerência** (perfil `admin`, que já é quem representa a gestão no modelo de acesso do painel — não existe um papel separado de "gerência"): criar, editar e excluir uma regra de mercado (DCTFWeb, ICMS-ST, ECD etc.), com categoria, frequência, dia de vencimento (fixo ou Nº-ésimo dia útil), ajuste de dia útil e observações.

Uma regra é só um **modelo de referência** — nunca uma obrigação de verdade de nenhuma empresa:
- **Usar como modelo:** no formulário de "Nova obrigação", um seletor opcional "Usar modelo de mercado" pré-preenche nome/categoria/frequência/dia/mês(es)/ajuste de dia útil/observações a partir de uma regra escolhida. Só existe ao **criar** (não ao editar uma obrigação já existente).
- **Sem vínculo permanente:** escolher uma regra só copia os valores para o formulário naquele momento. Depois de salva, a obrigação é independente — editar ou excluir a regra original mais tarde não muda nada nas obrigações já cadastradas a partir dela.
- **Frequências suportadas:** só `mensal`, `trimestral`, `anual` — uma regra reutilizável não faz sentido para `pontual` (data única), que por definição não se repete.

O schema já vem com um **seed** de obrigações comuns no mercado brasileiro (DCTFWeb, EFD Contribuições, FGTS, DAS do Simples Nacional, ICMS-ST, ISS, ECD, ECF), inserido com `on conflict (name) do nothing` — roda de novo sem duplicar nem sobrescrever o que a gerência já tiver customizado. **Atenção:** essas datas são referências de mercado amplamente praticadas, não aconselhamento tributário — confira sempre contra a legislação/calendário oficial vigente antes de usar como modelo (prazos mudam por lei, prorrogação ou particularidade de UF/município).

**Aplicar um modelo a várias empresas de uma vez:** em Gerenciar → Regras, cada regra tem um botão "🏢 Aplicar a empresas" que abre um diálogo com checkbox por empresa cadastrada (mais "marcar todas"/"desmarcar todas"). Ao confirmar, cria uma obrigação nova em cada empresa marcada, copiando os campos da regra (`js/data.js`, `doApplyRuleToCompanies`) — uma chamada só em `createObligationsBulk`. Empresas que **já** têm uma obrigação com o mesmo nome são puladas automaticamente (comparação simples por nome, já que não existe um vínculo formal entre regra e obrigação); o toast final informa quantas foram criadas e quantas foram puladas. Assim como o uso individual, isso continua sendo só uma cópia inicial dos valores — depois de criadas, as obrigações são independentes da regra.

## Regimes tributários e obrigações automáticas por empresa

Em Gerenciar → Regimes tributários, a gerência mantém um catálogo de regimes (`tax_regimes`: Simples Nacional, Lucro Presumido, Lucro Real, MEI) e liga cada um a duas coisas, tudo na mesma tela:

- **🔗 Vincular obrigações:** um diálogo de checkboxes com todo o catálogo de regras (Gerenciar → Regras) — marca quais obrigações valem para aquele regime (tabela M:N `tax_regime_rules`, já que uma obrigação como FGTS costuma valer para vários regimes ao mesmo tempo).
- **🏢 Vincular empresas:** um diálogo parecido, mas com as empresas cadastradas. Cada empresa só tem **um** regime por vez (`companies.tax_regime_id`) — marcar uma empresa que já estava em outro regime move ela para o novo, e o diálogo avisa isso antes de salvar.

Com os dois vínculos feitos, **Gerenciar → Empresas** mostra o regime de cada empresa e um botão **"📋 Trazer obrigações do regime"**: cria de uma vez só uma obrigação para cada regra vinculada ao regime da empresa (pulando as que ela já tem, comparando por nome), já com o **checklist-padrão** de cada regra copiado (`obligation_rules.checklist_template`, um passo por linha, editável no modal de regra) — ver próxima seção sobre como esse checklist funciona depois de criado.

**Não é aconselhamento tributário nem integração com uma base de dados oficial do Governo:** não existe hoje uma API pública estruturada e gratuita com a relação "regime → obrigação" pronta para consumir — o schema já vem com um vínculo inicial curado manualmente a partir de prática de mercado (seção 16 do `sql/schema.sql`), do mesmo jeito e com a mesma ressalva do catálogo de regras. Confira sempre o enquadramento fiscal real de cada empresa (atividade, faturamento, UF, município) antes de usar como modelo.

## Ajuste de data de uma ocorrência (exceção pontual)

Além de editar a regra de recorrência inteira, a gerência pode prorrogar ou antecipar a data de vencimento de **uma única ocorrência**, sem mexer na recorrência das próximas. Em Gerenciar → Obrigações, o botão "🗓 Ajustar data" (visível quando há uma próxima ocorrência calculada) abre um diálogo para escolher a nova data e, opcionalmente, um motivo (ex.: "prorrogação divulgada pela Receita").

- **Onde fica salvo:** tabela nova `obligation_date_overrides` (`obligation_id`, `original_date`, `override_date`, `reason`), com uma chave única em `(obligation_id, original_date)` — ou seja, um ajuste por ocorrência. `original_date` é a data bruta calculada pela regra (a mesma usada como identidade da ocorrência para fins de conclusão/histórico); `override_date` é a data efetiva mostrada na tela.
- **O que muda visualmente:** o cartão no Painel, a lista de Gerenciar → Obrigações, a Lista de risco e o score preditivo da Visão Executiva passam a considerar a data ajustada (`displayDate`) para status/ordenação/cor, e mostram um aviso "📌 data ajustada manualmente" com a data padrão original entre parênteses.
- **O que não muda:** a conclusão da ocorrência continua vinculada à `original_date`. O ajuste é uma camada de exibição sobre o cálculo normal; o serviço de notificações AWS usa a mesma lógica compartilhada de ocorrências.
- **Remover um ajuste:** reabrir o mesmo diálogo mostra um botão "Remover ajuste" que apaga a exceção e volta a usar o vencimento padrão da regra.

## Prioridade, checklist, comentários e histórico

- **Prioridade** (`obligations.priority`): `baixa | media | alta | critica`, validada só na interface (dropdown fechado). Obrigações `alta`/`critica` ganham um selo vermelho no cartão, independente do status de prazo.
- **Checklist** (`checklist_items`): lista de passos cadastrada pelo admin em cada obrigação (aparece dentro do modal de edição), opcionalmente pré-populada a partir do checklist-padrão de uma regra/regime (ver seções acima). Cada item guarda seu **próprio estado marcado/desmarcado** (`completed`, `completed_by`, `completed_at`) — qualquer pessoa autenticada pode marcar um passo direto no cartão do Painel (ou na lista de Gerenciar → Obrigações) ao longo do período, sem precisar abrir o diálogo de conclusão, e o percentual do ciclo atual ("Checklist: 2/5 — 40%") aparece ao vivo nos dois lugares. Marcar/desmarcar passa por uma função do banco (`set_checklist_item_done`, `security definer`) em vez de um update direto — assim não é preciso ser admin para concluir um passo (só para criar/editar/excluir os passos em si, que continuam sendo o "modelo" definido pela gerência). O diálogo de conclusão (`ui/completeDialog.js`) continua exigindo tudo marcado antes de liberar o botão "Concluir", mas agora abre com os itens já marcados que a pessoa foi resolvendo durante o período — e ainda dá para marcar o que faltar ali mesmo. Depois de uma conclusão bem-sucedida, o checklist é reiniciado (`reset_checklist_items`) para o próximo ciclo (mês/trimestre/ano seguinte) começar do zero, sem perder o que já ficou registrado na conclusão anterior (`completions.checklist_total`/`checklist_checked`, usado para mostrar "3/3 itens" no histórico de conclusões).
- **Comentários** (`obligation_comments`): qualquer pessoa autenticada comenta; só o autor ou um admin exclui. Aparecem dentro do modal de edição da obrigação (só quando editando, não ao criar — precisa existir um `obligation_id`).
- **Trilha de auditoria** (`audit_log`): populada automaticamente por gatilhos (`log_obligation_change()`) em todo INSERT/UPDATE/DELETE de `obligations`. Não existe política de escrita para o papel `authenticated` nessa tabela — só o gatilho grava (via `security definer`), e só admins conseguem consultar (aba Gerenciar → Histórico). A lista das últimas 200 alterações passa por duas heurísticas simples de detecção de anomalia, calculadas no front-end (`js/ui/manageAudit.js`), que marcam a linha com um selo "⚠ Anomalia" sem bloquear nada: **exclusão seguida de recriação** com o mesmo nome em menos de 48h (pode ser recadastro legítimo, ou alguém tentando "limpar" o histórico de uma obrigação excluindo e recriando do zero), e **edição de campo de vencimento** (`due_date`/`day_of_month`/`month`/`months`) numa obrigação que hoje está atrasada ou vencendo em breve (pode ser correção legítima de um erro de cadastro, mas vale conferir com quem editou). Não é acusação automática nem um modelo de ML — só estatística simples sobre o que o painel já registra.
- **Quem concluiu e quando**: sempre foi gravado (`completions.done_by_name`, `completions.done_at`), mas numa versão anterior não estava visível na tela. Agora aparece direto no cartão do painel (`.card-last-completion`) e na lista de Gerenciar → Obrigações.

## Feriados e dia útil fiscal

Cada obrigação tem dois campos independentes relacionados a dia útil, que resolvem problemas diferentes:

- **`day_type = 'util_do_mes'`** — muda o *significado* de `day_of_month`: em vez de "todo dia 10", passa a ser **"o Nº-ésimo dia útil do mês"** (ex.: 10 = 10º dia útil), contando a partir do dia 1 e pulando fins de semana e os feriados cadastrados em `holidays`. Implementado em `dateUtils.js → nthBusinessDayOfMonth()`. Isso cobre o caso de uso fiscal real (EFD Contribuições, por exemplo, costuma vencer no "10º dia útil").
- **`business_day_shift`** — depois de calculada a data (fixa ou por dia útil), decide o que fazer se ainda assim cair num fim de semana/feriado (`shiftToBusinessDay()`). Três opções, tanto em obrigações quanto em regras do catálogo:
  - `nenhum` — mantém a data mesmo caindo em dia não útil.
  - `proximo_util` — **empurra** para o próximo dia útil (comportamento antigo, único que existia antes).
  - `anterior_util` — **antecipa** para o dia útil anterior. Útil para tributos cuja prática de mercado é antecipar em vez de adiar (ex.: FGTS, quando o dia 7 cai num fim de semana, costuma ser antecipado, não adiado).
  
  É um ajuste de segurança adicional, independente do `day_type`. (Esta coluna substitui o antigo `adjust_business_day`, que só sabia empurrar para a frente — a coluna booleana antiga continua na tabela, sem uso pelo app, porque excluir/renomear coluna seria uma migração destrutiva; um backfill único converteu `true` para `proximo_util` na primeira vez que o `schema.sql` novo rodar.)

Os dois campos podem ser usados juntos ou separados. Nenhum dos dois tenta adivinhar regras específicas de tributo/UF/município além de "pular fim de semana e feriado cadastrado" — para uma obrigação com regra de vencimento mais peculiar que isso, ajuste manualmente com base no calendário oficial do tributo.

Feriados podem ser cadastrados manualmente (Gerenciar → Feriados) ou importados automaticamente de **BrasilAPI** (`https://brasilapi.com.br/api/feriados/v1/{ano}`), um serviço público e gratuito mantido pela comunidade — não é do Supabase nem da Anthropic. Se ele ficar fora do ar, a importação automática falha mas o cadastro manual continua funcionando. **Importante:** BrasilAPI só cobre feriados **nacionais** — feriados estaduais e municipais (que afetam bastante obrigação municipal/ISS) precisam ser cadastrados manualmente.

## Comprovante obrigatório (Supabase Storage)

Bucket `comprovantes` (privado), criado pelo próprio `schema.sql` via `insert into storage.buckets`. **O comprovante é obrigatório desde esta versão** — marcar uma obrigação como concluída abre `ui/completeDialog.js`, que exige todos os itens do checklist marcados (se houver) **e** um arquivo anexado antes de habilitar o botão "Concluir". Cancelar o diálogo não grava nada — a conclusão só é criada depois que o upload do comprovante já deu certo, com `attachment_path` preenchido no mesmo INSERT (não é mais um passo separado como numa versão anterior).

Essa obrigatoriedade é aplicada em **duas camadas**, não só na tela:
1. A interface não deixa concluir sem os dois requisitos.
2. O banco tem uma constraint (`completions_attachment_required`, `check (attachment_path is not null)`) que rejeita qualquer INSERT sem comprovante — mesmo que alguém tente burlar a interface chamando a API diretamente.

A constraint foi adicionada com `NOT VALID` de propósito: isso faz a regra valer só para gravações **novas**, sem invalidar retroativamente conclusões antigas (registradas antes dessa mudança, sem comprovante) — elas continuam existindo normalmente no histórico.

Como o bucket é privado, a visualização usa um link assinado (`createSignedUrl`, válido por 1 hora), gerado sob demanda a partir do cartão no painel ou de Gerenciar → Obrigações.

## Conferência automática de competência do comprovante (OCR no navegador)

Ao anexar o comprovante em `ui/completeDialog.js`, o arquivo passa por leitura de texto **direto no navegador** (`js/ocr.js` — sem serviço externo pago, sem backend próprio, sem enviar o arquivo para lugar nenhum além do Supabase Storage). O texto lido é vasculhado por padrões de competência (`"competência 07/2026"`, `"período de apuração 07/2026"`, `"Julho de 2026"`, etc.) e comparado com o mês/ano da ocorrência sendo concluída — aceitando também o mês anterior, porque várias obrigações vencem num mês apurando a competência do mês passado.

Dois formatos são suportados, cada um do seu jeito:
- **Imagem** (foto/print do comprovante): OCR completo via [Tesseract.js](https://github.com/naptha/tesseract.js) (CDN em `index.html`).
- **PDF**: primeiro tenta ler o texto já embutido no arquivo via [pdf.js](https://mozilla.github.io/pdf.js/) (rápido e exato — cobre a maioria das guias geradas digitalmente, ex.: DARF/GPS emitidos por sistema). Se o PDF não tiver texto (documento escaneado ou foto salva como PDF), a primeira página é renderizada num `<canvas>` e passa pelo mesmo OCR das imagens.

**Isso é heurístico, de propósito nunca bloqueia sozinho:**
- Outros formatos (nem imagem, nem PDF) ficam marcados como "não verificado" (`ocr_status = 'not_checked'`), não como erro.
- Se não achar nenhuma data de competência reconhecível no texto lido (de nenhuma das duas fontes acima), também fica como "não verificado" — não impede a conclusão.
- Se achar uma competência que **não bate** com a ocorrência (nem o mês, nem o mês anterior), a pessoa vê um aviso na hora (`ui/completeDialog.js`) e precisa marcar "Confirmo que revisei e está correto mesmo assim" para o botão "Concluir" liberar — a conclusão é sempre gravada, só fica sinalizada (`completions.ocr_status = 'mismatch'`, `completions.ocr_extracted_period` com o texto encontrado).
- Divergências sinalizadas aparecem para o gestor na Visão Executiva e no resumo diário enviado pela Lambda de notificações AWS.

**Limitação honesta:** leitura de OCR de documento fiscal real (guias escaneadas, fotos de celular, diferentes órgãos com layouts diferentes) é bem menos confiável do que ler texto embutido de um PDF nativo — espere alguns segundos de análise por arquivo (mais em PDF escaneado, que passa pelas duas etapas), e trate isso como um alerta a mais para o analista revisar, não como uma auditoria automática confiável. Só lê as duas primeiras páginas do PDF. Não foi testado contra uma variedade real de guias (DARF, GPS, boletos etc.), só com texto sintético nos testes automatizados.

## Relatórios (taxa de cumprimento)

Aba "Relatórios" (admin), calculada inteiramente no front-end a partir de `STATE.completions` — sem tabela nova. "No prazo" = a data de `done_at` é igual ou anterior à `occurrence_date` da conclusão. Mostra a taxa geral e quebrada por empresa e por responsável, considerando só os últimos 6 meses. Ficou restrito a admins de propósito: são dados de desempenho de pessoas específicas, e achamos mais apropriado isso não ficar visível para qualquer membro da equipe.

## Visão executiva

Aba "Visão Executiva" (admin), `js/ui/dashboard.js` — calculada inteiramente no front-end a partir do que já está em `STATE` (sem tabela nova), pensada como o painel de gestão de quem acompanha o compliance da equipe como um todo, não obrigação por obrigação. Seções, nesta ordem:

- **KPI geral**: contagem por status (atrasada/vence em breve/no prazo/sem pendência) + taxa de cumprimento no prazo dos últimos 6 meses.
- **Lista de risco**: obrigações de prioridade alta/crítica que estão atrasadas ou vencendo em breve — o que precisa de atenção imediata.
- **Risco preditivo de atraso**: sinaliza obrigações que hoje **ainda estão no prazo**, mas cujo histórico de conclusões mostra uma taxa de atraso ≥ 30% — para o gestor agir *antes* do prazo apertar, não só depois. Usa o histórico da própria obrigação quando existe (mínimo de 3 conclusões registradas, senão a amostra é considerada pequena demais para significar algo); se a obrigação for nova e não tiver histórico próprio, cai para o histórico do grupo empresa+categoria. **É estatística simples sobre dados que o painel já coleta, não um modelo treinado** — sem chamada a serviço externo nem custo adicional.
- **Divergências de comprovante**: lista agregada das conclusões cuja competência do comprovante (lida por OCR) não bateu com a ocorrência — ver seção "Conferência automática de competência" abaixo para o funcionamento completo; aqui é só a visão consolidada para o gestor.
- **Concentração de vencimentos**: destaca dias, dos próximos 30, com uma concentração de vencimentos bem acima da média (mais de 1,5× a média dos dias que têm pelo menos um vencimento) — puramente informativo, nada é reagendado sozinho; a ideia é o gestor enxergar picos de carga com antecedência e decidir se vale antecipar alguma obrigação flexível.
- **Visão tática**: as mesmas contagens de status + taxa de cumprimento (6 meses), quebradas em três tabelas — por empresa, por categoria e por responsável — para achar padrões ("essa empresa está sempre atrasando", "esse tipo de obrigação é recorrente atrasar").
- **Tendência de cumprimento**: taxa de cumprimento mês a mês, últimos 6 meses.

## Alertas diários por e-mail

Após o cutover, o EventBridge Scheduler invoca uma Lambda dedicada descrita em
`aws/template.yaml`. Ela consulta cada workspace separadamente no DynamoDB,
reutiliza sem alteração `scripts/alertas-core.mjs`, deduplica retries por dia e
destinatário e envia pelo SES. Perfis inativos são ignorados; responsáveis e
gestores mantêm os filtros de workspace/módulo, inclusive divergências OCR das
últimas 24 horas. Métricas e logs estruturados registram apenas contagens e
identificadores técnicos, sem e-mails ou nomes.

A validação e o deploy do serviço de notificações fazem parte do pipeline AWS. Consulte `aws/README.md` para operação e observabilidade.

## Papéis de acesso (RLS)

Implementado inteiramente com recursos gratuitos do Supabase (Postgres RLS
+ uma tabela `profiles` + uma função `security definer` para evitar
recursão nas políticas). Ver `sql/schema.sql` para o detalhe de cada
política. Resumo:

### Categorias e validação

As categorias agora são carregadas do catálogo `categories`; as cinco
categorias originais são publicadas automaticamente e a Gestão pode criar,
ordenar, desativar ou reclassificar outras em **Gerenciar → Categorias**.

Toda tarefa nova exige validação. A Gestão escolhe o validador na obrigação
ou define um padrão por categoria em **Gerenciar → Validação**. Ao enviar o
comprovante, a ocorrência fica em **Aguardando validação**; somente a aprovação
do validador designado muda o estado para **Concluída**. Uma rejeição reabre a
ocorrência para correção e reenvio, e o banco impede autovalidação.

| Ação                                   | admin | gestor | membro |
|-----------------------------------------|:-----:|:------:|:------:|
| Ver obrigações e conclusões             |  ✅   |   ✅   |   ✅   |
| Criar obrigação                         |  ✅   |   ✅   |   ✅   |
| Editar/excluir obrigações               |  ✅   |   ✅   |   ❌   |
| Marcar obrigação como concluída         |  ✅   |   ✅   |   ✅   |
| Anexar comprovante a uma conclusão      |  ✅   |   ✅   |   ✅   |
| Desfazer **própria** conclusão          |  ✅   |   ✅   |   ✅   |
| Desfazer conclusão de **outra pessoa**  |  ✅   |   ❌   |   ❌   |
| Criar/editar/excluir empresas           |  ✅   |   ❌   |   ❌   |
| Alterar papel de acesso de alguém       |  ✅   |   ❌   |   ❌   |
| Revogar/reativar acesso de uma conta    |  ✅   |   ❌   |   ❌   |
| Enviar link de redefinição de senha para alguém |  ✅   |   ❌   |   ❌   |
| Comentar numa obrigação                 |  ✅   |   ✅   |   ✅   |
| Excluir comentário de **outra pessoa**  |  ✅   |   ❌   |   ❌   |
| Cadastrar/excluir itens de checklist    |  ✅   |   ❌   |   ❌   |
| Ver trilha de auditoria                 |  ✅   |   ❌   |   ❌   |
| Cadastrar/excluir feriados              |  ✅   |   ❌   |   ❌   |
| Ver relatórios de cumprimento           |  ✅   |   ✅   |   ❌   |
| Ver Visão Executiva (KPIs, risco preditivo, concentração) |  ✅   |   ✅   |   ❌   |
| Ver catálogo de regras de mercado       |  ✅   |   ❌   |   ❌   |
| Criar/editar/excluir regras de mercado  |  ✅   |   ❌   |   ❌   |
| Ver catálogo de regimes tributários     |  ✅   |   ❌   |   ❌   |
| Criar/editar/excluir regimes tributários e seus vínculos |  ✅   |   ❌   |   ❌   |

Importante: essas regras são aplicadas **no banco de dados** (RLS), não só
escondendo botões na tela. Esconder o botão "Editar" para quem é membro é
somente uma conveniência de interface — mesmo que alguém tente chamar a API
diretamente, o Postgres permite a criação no workspace do perfil, mas recusa
edição ou exclusão por membros. Isso torna o controle de acesso confiável, e não só
cosmético.

O **primeiro** administrador do projeto precisa ser promovido manualmente
rodando um `UPDATE` no SQL Editor (passo a passo no SETUP.md), já que
ainda não existe nenhum admin para usar a tela de Equipe. Depois desse
primeiro passo, promover ou rebaixar qualquer outra pessoa já pode ser
feito direto pela aba Gerenciar → Equipe, sem precisar mais de SQL.

## Segurança contra XSS

Todo texto vindo de dados do usuário (nome da obrigação, observações, nome
de responsável, e-mail etc.) passa pela função `escapeHtml()`
(`js/dateUtils.js`) antes de entrar no HTML gerado. Isso vale para todos os
pontos onde o código monta HTML por concatenação de string (`board.js`,
`manage.js`, `modal.js`, `toolbar.js`, `toast.js`, `render.js`,
`confirmDialog.js`) — nenhum campo de texto livre é inserido sem escapar.

A chave pública do Supabase (`anon key`) em `config.js` fica exposta no
código-fonte por design — isso é seguro porque quem protege os dados de
verdade são as políticas de RLS no banco, não o sigilo dessa chave. Nunca
coloque a `service_role key` (essa sim é secreta) em nenhum arquivo deste
projeto.

## Feedback visual (sem `alert()`/`confirm()`)

- `js/ui/toast.js` — notificações não-bloqueantes no canto da tela
  (sucesso, erro, informação), com fechamento automático ou manual.
- `js/ui/confirmDialog.js` — diálogo de confirmação estilizado, usado antes
  de excluir uma obrigação ou desfazer uma conclusão. Retorna uma
  `Promise<boolean>`, então o código que chama (`data.js`) só continua se a
  pessoa confirmar.
- Erros de conexão com o Supabase (queda de internet, etc.) aparecem como
  um banner vermelho no topo do painel com botão "Tentar de novo"
  (`render.js`, função `renderConnBanner`), em vez de um erro silencioso só
  no console como no painel antigo.

## Fluxo de dados

1. `app.js` faz login, busca o perfil (`api/auth.js → fetchMyProfile`) e
   chama `data.js → loadAll()`, que busca `obligations`, `completions` e
   `companies` em paralelo.
2. `render.js → render()` monta a tela inteira a partir de `STATE`
   (`state.js`) e usa **delegação de eventos**: um único listener de clique
   no `#app` decide o que fazer com base no atributo `data-action` do
   elemento clicado. Isso evita ter que religar listeners a cada
   re-renderização.
3. Ações do usuário (marcar concluído, salvar, excluir) chamam funções de
   `data.js`, que conversam com `api/*.js`, atualizam `STATE` localmente e
   chamam `render()` de novo — sem recarregar a página inteira do
   Supabase a cada clique.

## Rodando localmente para desenvolvimento

```bash
# na pasta do projeto
npx serve .
# ou
python3 -m http.server 8080
```

Abra `http://localhost:.../index.html`, preencha `js/config.js` com as
credenciais de um projeto Supabase de teste (ou de desenvolvimento) e rode
`sql/schema.sql` nesse projeto antes de testar.

## Limitações conhecidas / próximos passos possíveis

- **Criar, editar, revogar e mandar redefinição de senha** de uma conta é
  feito pela própria interface (Gerenciar → Equipe) — ver seção "Criação
  de contas de usuário" acima. **Excluir** a conta de autenticação de vez,
  ou **trocar a senha de outra pessoa diretamente** (sem passar pelo
  e-mail de redefinição), ainda dependem do painel do Supabase
  (Authentication → Users), porque isso exige a `service_role key`, que o
  app não tem por design (100% client-side). "Revogar acesso" e "Redefinir
  senha" cobrem os casos de uso mais comuns (afastar alguém da equipe,
  ajudar quem esqueceu a senha) sem precisar dessa chave. Dependendo da
  configuração de confirmação de e-mail do projeto, a pessoa recém-criada
  pode precisar confirmar o e-mail (ou um admin confirmar manualmente pelo
  painel do Supabase) antes do primeiro login — ver seção "Criação de
  contas de usuário" acima.
- O **primeiro** administrador de um projeto novo ainda exige rodar um
  `UPDATE` manual no SQL Editor (documentado no SETUP.md), porque até esse
  ponto não existe nenhum admin para usar a tela de Equipe.
- O ajuste de "dia útil" combina duas regras: contar o Nº-ésimo dia útil
  do mês (`day_type = 'util_do_mes'`) e empurrar/antecipar para longe de
  fins de semana/feriados cadastrados (`business_day_shift`) — ver seção
  própria acima. Nenhuma das duas cobre regras de vencimento mais
  específicas por tributo/UF/município além disso.
- O vínculo "regime tributário → obrigação" (Gerenciar → Regimes
  tributários) é um ponto de partida curado manualmente, não uma
  integração com nenhuma base de dados oficial do Governo — não existe
  hoje uma API pública estruturada e gratuita para isso. Confira sempre o
  enquadramento fiscal real de cada empresa antes de usar como modelo.
- Conclusões registradas **antes** da mudança que tornou o comprovante
  obrigatório continuam existindo sem anexo — a regra nova não é
  retroativa (ver a constraint `NOT VALID` na seção de comprovantes).
- Os alertas por e-mail devem ser validados com destinatários controlados no
  SES antes de habilitar `NotificationScheduleState`; esta alteração não faz deploy.
- O repositório possui testes automatizados de frontend, contratos de API, migração e backend AWS executados em CI.

### Modelos minuciosos de checklist Sankhya

O projeto inclui modelos operacionais derivados da planilha `Checklist_Minucioso_Entregas_Sankhya.xlsx` para **85 obrigações únicas** (1.039 etapas de controle). O painel reconhece o modelo pelo nome da obrigação, ignorando diferenças de acentuação, caixa e pontuação.

- `js/obligationChecklistTemplates.js`: versão compacta usada em tempo de execução. Ao cadastrar ou importar uma obrigação conhecida, o checklist é criado automaticamente. Uma regra cadastrada pela Gestão com `checklist_template` próprio continua tendo precedência.
- `data/sankhya-obligation-models.json`: fonte detalhada com fase, instrução de execução, critério de aceite, evidência mínima, rotina Sankhya, análise Excel e portal/validador para evolução futura da interface.
- `sql/migrations/20260814_backfill_sankhya_checklists.sql`: preenche os itens faltantes das obrigações que já estavam cadastradas antes desta versão, sem apagar checklists personalizados existentes.

Depois de publicar os arquivos, execute a migração acima uma vez no SQL Editor do Supabase para completar as obrigações já existentes. Novas obrigações passam a receber o modelo automaticamente pelo código.
