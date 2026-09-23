# O que mudou nesta refatoração — e por quê

Resumo para você explicar à equipe (ou só para consulta sua). Nada do que a
equipe faz no dia a dia muda: continuam acessando pelo navegador, com
e-mail e senha, vendo o mesmo visual e as mesmas funções.

## 1. Duas pessoas não sobrescrevem mais o trabalho uma da outra

**Antes:** o painel inteiro (todas as obrigações e conclusões de todo
mundo) ficava guardado como um único "pacote" de dados. Quando alguém
salvava algo, o pacote inteiro era regravado. Se duas pessoas mexessem no
painel ao mesmo tempo — por exemplo, uma marcando uma obrigação como
concluída e outra cadastrando uma nova —, a segunda gravação podia
sobrescrever a primeira sem nenhum aviso. Isso é chamado de conflito
"last-write-wins" e é um risco real em qualquer ferramenta usada por mais
de uma pessoa ao mesmo tempo.

**Agora:** cada obrigação e cada conclusão é guardada separadamente no
banco de dados. Marcar uma obrigação como concluída só grava aquela
conclusão específica — não toca em mais nada. Se, por azar, duas pessoas
clicarem "concluído" na mesma obrigação no mesmo segundo, o sistema
detecta a duplicidade e evita gravar duas vezes, sem perder o registro de
ninguém.

## 2. Nem todo mundo pode cadastrar ou excluir obrigações

**Antes:** qualquer pessoa com login conseguia cadastrar, editar ou
excluir qualquer obrigação do painel.

**Agora:** existem dois níveis de acesso:
- **Administrador** — pode cadastrar, editar e excluir obrigações e
  empresas, e alterar quem é administrador ou membro, além de tudo que um
  membro pode fazer.
- **Membro** — vê o painel inteiro e marca obrigações como concluídas (ou
  desfaz uma conclusão que ele mesmo registrou), mas não cadastra, edita
  nem exclui obrigações, empresas ou papéis de acesso.

Essa regra é garantida pelo próprio banco de dados, não só escondendo
botões na tela — então é uma proteção de verdade, não só uma questão de
aparência. Por padrão, todo mundo entra como "membro"; você decide quem
vira administrador (normalmente 1–2 pessoas da controladoria).

## 3. Administradores agora gerenciam tudo direto pelo painel

**Antes:** cadastrar/editar obrigações já era possível pela tela; mas
cadastrar empresas só acontecia de forma indireta (digitando um nome novo
no formulário de obrigação, sem opção de renomear ou excluir depois), e
promover alguém a administrador exigia entrar no SQL Editor do Supabase.

**Agora:** a aba "Gerenciar" ganhou três seções, visíveis só para
administradores:
- **Obrigações** — cadastrar, editar e excluir (como já era).
- **Empresas** — cadastrar, renomear e excluir, com contagem de quantas
  obrigações estão vinculadas a cada uma.
- **Equipe** — ver todas as contas e alternar o papel de acesso
  (admin ⇄ membro) de qualquer pessoa com um clique.

Criar a conta em si (e-mail/senha) continua sendo feito pelo painel do
Supabase — é a forma mais simples de manter isso sem custo e sem expor
credenciais sensíveis no navegador — mas agora, depois que a conta existe,
tudo o mais (inclusive promover a admin) é feito dentro do próprio painel,
sem precisar mexer em SQL no dia a dia.

## 4. Sem mais "OK" e "Cancelar" do navegador

**Antes:** ações como excluir uma obrigação ou desfazer uma conclusão
usavam as caixinhas cinzas padrão do navegador ("Tem certeza? OK/Cancelar"),
que têm cara de spam/propaganda para muita gente e não seguem o visual do
painel.

**Agora:** as confirmações e os avisos (ex.: "obrigação salva",
"não foi possível salvar, tente de novo") aparecem integrados ao visual do
painel — janelinhas de confirmação e notificações discretas no canto da
tela, sem interromper o fluxo.

## 5. Avisos claros quando a internet cai

**Antes:** se a conexão com o banco de dados falhasse, o erro só aparecia
no "console" do navegador — um lugar técnico que ninguém da equipe olha.
Na prática, parecia que o painel simplesmente não fazia nada.

**Agora:** falhas de conexão aparecem como um aviso vermelho no topo do
painel, explicando o que houve e com um botão para tentar de novo.

## 6. Publicação deixou de ser manual

**Antes:** publicar uma alteração era: editar o arquivo HTML no
computador → publicar de novo no provedor estático anterior. Fácil, mas manual, sem
histórico de versões, e fácil de esquecer um passo.

**Agora:** o projeto fica guardado no GitHub (gratuito, com histórico
completo de tudo que mudou) e a publicação é automática — assim que um
arquivo é atualizado no GitHub, o site é republicado sozinho em menos de
um minuto. Reduz o risco de erro manual e dá para voltar a uma versão
anterior se algo sair errado.

## 7. Código mais fácil de manter no futuro

Por trás da tela, o código foi reorganizado (mais moderno, dividido em
arquivos menores por responsabilidade, com comentários explicando as
partes mais importantes). Isso não muda nada para quem usa o painel, mas
significa que futuras alterações ou correções são mais rápidas e com menos
risco de quebrar algo sem querer.

## 8. Um bug de exibição corrigido

Durante a refatoração, identificamos e corrigimos um problema técnico
sutil na tela de cadastro/edição de obrigações que, dependendo do
navegador, podia deixar uma camada invisível cobrindo a tela e
ocasionalmente atrapalhando cliques. Não era visível a olho nu, mas foi
corrigido — mais uma vantagem de ter revisado o código a fundo.

## 9. "Minhas obrigações" e cadastro em massa por CSV

**Antes:** para saber "o que é meu", cada pessoa tinha que usar o filtro
"Todos os responsáveis" toda vez que abria o painel. E cadastrar uma leva
de obrigações novas (por exemplo, ao adicionar uma empresa nova) era
clicar em "+ Nova obrigação" uma vez para cada item, manualmente.

**Agora:**
- Uma aba nova, **"Minhas obrigações"**, mostra de cara só o que está
  vinculado à sua conta — sem precisar mexer em filtro nenhum.
- O campo "Responsável", no cadastro de obrigação, passou a oferecer a
  lista de contas da equipe (além da opção "Outro", para quem não usa o
  sistema, como um contador terceirizado) — isso é o que torna "Minhas
  obrigações" confiável, em vez de depender de bater um texto digitado.
- Uma tela nova em Gerenciar → **Importar CSV** permite cadastrar várias
  obrigações de uma vez, enviando uma planilha. O painel confere cada
  linha antes de gravar qualquer coisa, mostra o que está pronto para
  importar e o que tem erro (com o motivo), cria empresas novas
  automaticamente e tenta vincular o responsável a alguém já cadastrado.
  Só depois de você conferir e confirmar é que os dados entram no banco.

## 10. Oito melhorias de gestão, de uma vez

> **Sobre os dados que já estão cadastrados:** nenhuma obrigação, conclusão,
> empresa ou conta foi apagada ou alterada por essas mudanças. Todas as
> novidades usam tabelas e colunas novas, adicionadas ao banco sem tocar
> no que já existia — isso foi testado explicitamente antes da entrega.

Essa leva de mudanças foi pensada para o painel deixar de ser só um
"quadro de status" e virar uma ferramenta que ajuda a equipe a não deixar
nada passar.

**Prioridade nas obrigações.** Dá para marcar uma obrigação como Baixa,
Média, Alta ou Crítica. As de prioridade Alta/Crítica ganham um selo
vermelho no cartão, para chamar atenção mesmo que o prazo ainda esteja
longe.

**Comentários por obrigação.** Dentro do cadastro de cada obrigação, agora
dá para deixar recados para o time — "confirmado com o contador",
"prazo mudou, aguardando confirmação" — sem precisar de e-mail ou grupo de
WhatsApp paralelo.

**Histórico de quem mexeu em quê.** Toda criação, edição e exclusão de
obrigação fica registrada (quem fez, quando, o que mudou), visível para
administradores em Gerenciar → Histórico. Útil para auditoria e para
entender "por que isso mudou" sem precisar perguntar.

**Ajuste automático para dia útil.** Uma obrigação pode ser marcada para
"empurrar o vencimento se cair num fim de semana ou feriado". Feriados
nacionais podem ser importados com um clique; feriados estaduais/municipais
específicos da sua região, cadastrados manualmente.

**Comprovante anexado.** Ao marcar uma obrigação como concluída, aparece
um convite (opcional) para já anexar o comprovante — a guia paga, o
protocolo de envio, o que for. Fica salvo junto com aquela conclusão
específica, disponível para consulta depois.

**Relatório de cumprimento no prazo.** Uma aba nova (administradores)
mostra que porcentagem das obrigações dos últimos 6 meses foi cumprida no
prazo — geral, por empresa e por responsável. Dá para enxergar padrões
("essa empresa está sempre atrasando", "esse tipo de obrigação é
recorrente atrasar") sem precisar contar na mão.

**Alertas por e-mail.** Todo dia útil de manhã, quem tem obrigação
atrasada ou vencendo em breve recebe um e-mail automático — sem precisar
abrir o painel para descobrir. Administradores recebem também um resumo
geral da equipe inteira. (Esse item precisa de uma configuração extra,
opcional — ver SETUP.md.)

**Instalar como aplicativo.** O painel agora pode ser "instalado" no
celular ou no computador (como um aplicativo de verdade, com ícone
próprio), direto pelo navegador — sem passar por loja de aplicativo nenhuma.

## 11. Dia útil fiscal, checklist obrigatório e comprovante obrigatório

> **Sobre os dados que já estão cadastrados:** de novo, nada foi apagado —
> conferido explicitamente antes desta entrega, populando dados de teste e
> reaplicando o script por cima.

**Dia útil fiscal de verdade.** A versão anterior só evitava que um
vencimento caísse num fim de semana ou feriado. Agora dá para marcar uma
obrigação como "Nº-ésimo dia útil do mês" (ex.: 10º dia útil), que é como
várias obrigações fiscais brasileiras realmente funcionam — o painel conta
os dias úteis certinho, pulando fins de semana e os feriados cadastrados.

**Checklist por obrigação.** Cada obrigação pode ter uma lista de passos
cadastrada (ex.: "conferir base de cálculo", "gerar guia", "enviar
comprovante ao contador"). Na hora de concluir, todo item precisa estar
marcado — o botão "Concluir" só libera depois.

**Comprovante agora é obrigatório.** Antes era um convite opcional depois
de concluir; agora, concluir sem anexar o comprovante não é mais possível
— nem pela tela, nem "por fora" direto no banco (adicionamos uma trava lá
também, por segurança). Isso vale só para conclusões novas — nada do que
já foi concluído sem comprovante antes dessa mudança foi afetado.

**"Quem concluiu e quando" ficou visível.** Essa informação sempre existiu
no banco, mas antes só aparecia escondida. Agora está direto no cartão de
cada obrigação no painel, e também na lista de Gerenciar.

## 12. Comprovante conferido automaticamente (OCR, direto no navegador)

**Antes:** o comprovante anexado numa conclusão não era conferido por
ninguém — se alguém anexasse por engano a guia do mês errado, só se
descobria depois, "no olho".

**Agora:** ao anexar o comprovante para concluir uma obrigação, o arquivo
passa por uma leitura automática **dentro do próprio navegador** (sem
serviço externo pago, sem enviar o arquivo para lugar nenhum além do
Supabase), tentando reconhecer a competência (mês/ano) escrita no
documento e comparando com a ocorrência sendo concluída. Funciona tanto
para foto/print (OCR de imagem) quanto para PDF (lê o texto já embutido
quando existe — mais rápido e exato — ou cai para o mesmo OCR se for um
PDF escaneado). Se a competência não bater, a pessoa vê um aviso na hora e
precisa confirmar explicitamente que revisou mesmo assim — a conclusão
nunca é bloqueada, só fica sinalizada para o gestor ver depois, na Visão
Executiva e no e-mail diário de resumo. É uma conferência heurística,
pensada como um alerta a mais para o analista, não uma auditoria
automática 100% confiável.

## 13. Visão Executiva (e o Histórico) ficam mais preventivos

Quatro alertas novos, todos estatística simples sobre dados que o painel
já coletava — sem modelo treinado, sem serviço pago, sem infraestrutura
nova:

**Risco preditivo de atraso.** Antes, a Visão Executiva só mostrava o que
**já** estava atrasado ou vencendo em breve. Agora existe uma seção que
sinaliza, com antecedência, obrigações que hoje **ainda estão no prazo**
mas cujo histórico mostra uma taxa de atraso alta (30% ou mais) — para o
gestor agir antes do prazo apertar, não só depois.

**Balanceamento de carga ao escolher responsável.** No formulário de
obrigação, o seletor de "Responsável" agora mostra, ao lado de cada nome,
quantas pendências aquela pessoa já tem (ex.: "Ana — 2 pendentes"). A
escolha continua manual — é só para quem cadastra não escalar
"às cegas" alguém que já está sobrecarregado.

**Concentração de vencimentos.** Nova seção na Visão Executiva mostrando,
dos próximos 30 dias, quais dias têm uma concentração de vencimentos bem
acima do normal — puramente informativo (nada é reagendado sozinho), para
o gestor enxergar picos de carga com antecedência e decidir se vale
antecipar alguma obrigação flexível.

**Anomalias no Histórico.** Gerenciar → Histórico passa a destacar, com um
selo "⚠ Anomalia", duas situações que valem uma segunda olhada: uma
obrigação excluída e recriada com o mesmo nome em menos de 48h (pode ser
recadastro legítimo, ou alguém "resetando" o histórico), e uma edição no
vencimento de uma obrigação que hoje está atrasada ou vencendo em breve
(pode ser correção legítima, mas vale conferir com quem editou). Não é uma
acusação automática, só um sinal para checar.

## 14. Importação por CSV fica mais tolerante a erro de digitação

**Antes:** na importação em massa, o vínculo com o responsável só
funcionava se o nome digitado na planilha fosse **idêntico** ao já
cadastrado (ignorando maiúsculas/minúsculas) — qualquer acento faltando,
espaço a mais ou erro de digitação pequeno fazia a linha entrar sem
vínculo real com a conta da pessoa.

**Agora:** o painel aceita nomes parecidos (tolerando acento, pontuação e
um pequeno erro de digitação), mas com cautela — só vincula quando há um
candidato claramente melhor que os outros; em caso de dúvida, prefere não
vincular a arriscar a pessoa errada. Empresa é tratada de forma ainda mais
cautelosa: nome de empresa parecido com uma já cadastrada só gera um
**aviso** na prévia da importação, nunca mescla ou decide sozinho — quem
confirma a importação é quem decide se é duplicata de digitação ou uma
empresa realmente diferente.

## 15. Catálogo de regras de mercado, e aplicar um modelo a várias empresas de uma vez

**Antes:** cadastrar uma obrigação nova era sempre do zero, digitando
tudo — mesmo para obrigações padrão do mercado (DCTFWeb, FGTS, DAS, ICMS-ST
etc.) que se repetem de empresa para empresa.

**Agora:** a nova sub-aba Gerenciar → Regras é um catálogo de
obrigações-padrão, mantido pela gerência, já vindo com um ponto de partida
de obrigações comuns no mercado brasileiro (sempre com o aviso de
confirmar contra a legislação vigente antes de usar — não é aconselhamento
tributário). Ao cadastrar uma obrigação nova, dá para escolher um modelo
do catálogo para pré-preencher o formulário — só um atalho de
preenchimento, não cria vínculo permanente, então editar ou excluir a
regra depois não afeta obrigações já criadas a partir dela. E, direto no
catálogo, dá para aplicar um modelo a **várias empresas de uma vez**
(marcando quais, com "marcar/desmarcar todas"), pulando automaticamente
quem já tiver uma obrigação com aquele nome — sem risco de duplicar.

## 16. Ajuste pontual de data, sem alterar a regra de recorrência

**Antes:** se um prazo fosse prorrogado só naquele mês/trimestre (algo
comum quando o governo adia um vencimento), a única forma de refletir isso
no painel era editar a regra da obrigação inteira — o que também mudaria
todas as ocorrências futuras, não só aquela.

**Agora:** dá para ajustar (prorrogar ou antecipar) a data de **uma única
ocorrência**, com um motivo opcional, sem tocar na regra de recorrência —
as próximas ocorrências continuam seguindo o padrão normal. O cartão do
painel e a lista de Gerenciar mostram um aviso "📌 data ajustada
manualmente" nesses casos, e o ajuste pode ser removido a qualquer momento
para voltar à data original da regra.

## 17. Regimes tributários, criação de conta pela própria tela, e checklist sempre visível

Três evoluções, entregues juntas:

**Regimes tributários.** Nova sub-aba Gerenciar → Regimes tributários: um
catálogo de regimes (Simples Nacional, Lucro Presumido, Lucro Real, MEI),
com um ponto de partida de quais regras do catálogo de mercado costumam se
aplicar a cada regime (de novo, não é aconselhamento tributário — sempre
confirme contra o enquadramento real de cada empresa). Cada empresa pode
ser vinculada a um regime, e a tela de Empresas ganha um botão
"📋 Trazer obrigações do regime", que cria de uma vez as obrigações que
ainda faltam para aquela empresa, a partir do regime vinculado.

**Criação de conta pela própria tela.** Antes, criar a conta
(e-mail/senha) de alguém novo na equipe exigia entrar no painel do
Supabase. Agora isso é feito direto em Gerenciar → Equipe, com gerador de
senha temporária — a senha só aparece uma vez, numa caixa destacada, para
ser repassada por um canal seguro.

**Checklist sempre visível, com progresso ao vivo.** O checklist de uma
obrigação (ver item 11) ganhou uma barra de progresso visível direto no
cartão do painel e na lista de Gerenciar, com checkbox por item — não
precisa mais abrir o diálogo de conclusão para ir marcando os passos ao
longo do período. O diálogo de conclusão continua existindo, agora só
abrindo já com o que foi marcado antes.

## 18. Antecipar (não só empurrar) o dia útil de uma obrigação

**Antes:** quando um vencimento caía num fim de semana ou feriado, a única
opção do painel era empurrar para o próximo dia útil.

**Agora:** dá para escolher a direção — não ajustar, empurrar para o
próximo dia útil (como antes), ou **antecipar** para o dia útil anterior.
Útil para tributos cuja prática de mercado é antecipar em vez de adiar
(ex.: FGTS, quando o dia 7 cai num fim de semana). A opção fica disponível
tanto no cadastro de obrigação quanto no catálogo de regras de mercado.

## 19. Gestão de usuários: editar quem já tem conta, e revogar acesso sem excluir

**Antes:** em Gerenciar → Equipe só dava para criar conta nova ou
promover/rebaixar entre admin e membro — não tinha como corrigir o nome ou
o papel de alguém digitando o e-mail de novo (só tentando criar, o que
falhava), nem como tirar o acesso de alguém temporariamente sem excluir a
conta de verdade.

**Agora**, o mesmo formulário identifica se o e-mail já tem conta: se
tiver, atualiza nome e papel dessa conta em vez de tentar criar outra; se
não tiver, cria normalmente. E cada pessoa na lista ganha um botão
"Revogar acesso" (ou "Reativar acesso"), que bloqueia a entrada no painel
sem apagar a conta nem o histórico ligado a ela — útil para afastamento
temporário de alguém da equipe, com a possibilidade de reverter depois com
um clique.

## 20. Redefinir a senha de alguém, sem precisar da chave mestra do Supabase

**Antes:** se alguém esquecesse a senha ou precisasse trocar, a única
saída era um admin ir até o painel do Supabase e redefinir por lá — nada
disso podia ser feito de dentro do próprio painel.

**Agora**, cada pessoa na lista de Gerenciar → Equipe ganha um botão
"Redefinir senha": ao clicar, o painel manda um e-mail de recuperação para
o endereço cadastrado. A pessoa clica no link, e o painel mostra uma tela
para ela escolher a senha nova — só depois disso ela entra normalmente.
Continua não sendo possível um admin **definir** a senha de outra pessoa
diretamente (isso exigiria a chave mestra do projeto, que este painel
nunca guarda no navegador, de propósito — é o mesmo motivo pelo qual
criar conta já funcionava assim); o e-mail de redefinição é o jeito seguro
de resolver isso sem abrir mão dessa proteção.

## O que continua exatamente igual

- Visual do painel (cores, tipografia, layout dos cartões).
- Login por e-mail e senha, sem precisar instalar nada.
- Categorias, frequências (mensal/trimestral/anual/pontual), grupos por
  status (atrasada / vence em breve / no prazo / sem pendência).
- Uso 100% pelo navegador — nada muda na rotina de quem só usa o painel.
- Nenhum custo recorrente novo: continua tudo nos planos gratuitos do
  Supabase, GitHub e hospedagem estática.
