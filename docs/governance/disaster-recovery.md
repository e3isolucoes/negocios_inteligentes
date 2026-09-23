# Recuperação de desastre

## Objetivos iniciais

- RPO: até 30 dias durante validação sem receita; reduzir para 24 horas antes do
  primeiro contrato pago.
- RTO: até 8 horas durante validação; reduzir conforme SLA contratado.

## Conteúdo obrigatório do backup

- papéis e permissões do PostgreSQL;
- schema, funções, triggers, policies RLS e dados;
- tabelas `auth` para preservar contas e hashes de senha;
- metadados e objetos físicos do Supabase Storage;
- commit Git publicado e configuração dos provedores, sem registrar segredos.
- exportação lógica do DynamoDB por ferramenta, ambiente e `workspace_id`;
- inventário de objetos e versões do bucket S3, com hash e chave de cada objeto;
- template CloudFormation/SAM e parâmetros não secretos da stack AWS.

Backups e arquivos `.dump`, `.sql`, `.dpapi` ou documentos de clientes são
proibidos no Git. Devem permanecer criptografados e com acesso restrito.

## Procedimento de restauração

1. Declarar incidente e impedir novas gravações quando necessário.
2. Identificar o último backup íntegro e o commit correspondente.
3. Criar ambiente isolado, nunca restaurar diretamente sobre produção.
4. Restaurar papéis, schema, dados e depois os objetos do Storage.
5. Validar login, isolamento entre empresas, contagens, anexos e operações CRUD.
6. Atualizar URL/chave pública apenas após aprovação do responsável.
7. Executar smoke test, comunicar retorno e registrar causa raiz.

Para o plano AWS, restaurar primeiro uma tabela e um bucket isolados, reconciliar
contagens por empresa e somente então alterar a configuração do frontend. O
Supabase permanece disponível em leitura durante a janela de reversão descrita
em `aws-cutover-runbook.md`.

## Evidência mínima do teste trimestral

- data e responsável;
- hash SHA-256 dos arquivos usados;
- duração da restauração;
- contagens de usuários, empresas, obrigações e objetos do Storage;
- resultado dos testes de RLS e login;
- problemas encontrados e ações corretivas.
