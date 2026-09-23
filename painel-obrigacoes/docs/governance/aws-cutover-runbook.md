# Runbook de corte — Painel de Obrigações para AWS

## Princípios

- Produção permanece no Supabase até aprovação explícita.
- Não existe corte com migração parcial, diferença de contagem ou teste de
  isolamento pendente.
- O primeiro corte é por ferramenta, nunca por toda a plataforma ao mesmo tempo.
- Supabase fica em leitura durante a janela de reversão; não é removido no dia do corte.
- As evidências ficam em `.migration/` (gitignored, permissão `0600`). Elas nunca
  contêm linhas completas, anexos, tokens ou `SUPABASE_SERVICE_ROLE_KEY`.
- Tabelas sem `updated_at` não recebem high-water mark artificial: o delta é a
  diferença de chaves e SHA-256 entre os manifestos inicial e final.

## Comandos e artefatos

Execute em staging ou em uma sessão de migração aprovada; este runbook **não**
autoriza execução em produção. Todos os comandos aceitam `--report <arquivo>`.

1. `npm run plan -- --previous .migration/snapshot-inicial.json` — informa
   inserts, updates e deletes, sem gravar no destino.
2. `npm run snapshot -- --manifest .migration/snapshot-inicial.json` — cria o
   manifesto inicial canônico (entidade, workspace, source key, target key e hash).
3. Após o freeze, `npm run snapshot -- --manifest .migration/snapshot-final.json --previous .migration/snapshot-inicial.json`.
4. `npm run apply -- --manifest .migration/snapshot-final.json --previous .migration/snapshot-inicial.json`.
   Acrescente `--apply-deletes` **somente** após aprovar o relatório de deleções.
5. `npm run verify-content -- --manifest .migration/snapshot-final.json`.
6. `npm run verify-keys -- --manifest .migration/snapshot-final.json --cutover --extras-allowlist .migration/extras-allowlist.json`.
   A allowlist tem formato `{ "keys": [{ "PK": "...", "SK": "..." }] }`.
7. `npm run verify-files` e `npm run report -- --manifest .migration/snapshot-final.json`.

`apply` usa leitura consistente e escrita condicional por item, nunca BatchWrite.
Um rerun idêntico é no-op. Update ou delete só prossegue quando o destino ainda
tem exatamente o hash do manifesto anterior; qualquer edição concorrente vira
conflito explícito, sem sobrescrita.

## Critérios PASS/FAIL de entrada e corte

- CI verde e commit identificado;
- Lambda, DynamoDB, S3, orçamento e logs saudáveis;
- **PASS `snapshot final`:** delta registra exatamente todos os inserts, updates
  e deletes ocorridos durante o freeze. **FAIL:** fonte muda entre snapshot e apply.
- **PASS `apply`:** `status=PASS`, `conflicts=[]`; deleções esperadas são zero ou
  foram aprovadas e executadas com `--apply-deletes`. **FAIL:** qualquer conflito,
  inclusive item do destino alterado depois da migração.
- **PASS de identidade do manifesto:** `schemaVersion`, ferramenta e ambiente
  coincidem com a execução, há um `executionId`, todas as chaves são únicas e todo hash tem 64 dígitos
  hexadecimais. **FAIL:** manifesto adulterado, incompleto, duplicado ou produzido
  para outro ambiente; nenhum acesso ao target deve começar nesse caso.
- **PASS `verify-content`:** `status=PASS`, `mismatches=[]` para 100% dos itens.
  Um byte/campo diferente, ausente ou adicional é **FAIL**.
- **PASS `verify-keys --cutover`:** zero missing e zero extras fora da allowlist.
  Extra não aprovado é **FAIL**; extras sempre são contabilizados/classificados.
- **PASS de cobertura:** o manifesto e as verificações incluem `profiles`,
  `membership`, perfis/workspaces administrativos e `tax_regime_rules` herdadas.
- **PASS `verify-files`:** `matches=true`, `failed=[]` e `verified=source`.
  Hash, workspace ou completion divergente é **FAIL**.
- dois usuários de empresas distintas testados, sem leitura cruzada;
- CRUD, anexar, visualizar, concluir, desfazer e excluir validados;
- backup/exportação com hash e restauração testada em ambiente isolado;
- responsável, janela, comunicação e decisão de rollback definidos.

## Sequência de corte

1. Congelar gravações no Supabase e registrar horário.
2. Gerar o snapshot final e revisar o delta completo (insert/update/delete).
3. Aplicar condicionalmente e verificar conteúdo, chaves, cobertura e arquivos
   conforme os critérios PASS/FAIL acima; contagem ou amostragem não basta.
4. Ativar `backend=aws` na configuração de produção, sem parâmetro público de teste.
5. Executar smoke test com empresa piloto e depois com uma segunda empresa.
6. Monitorar erros, throttling e custo durante a janela.
7. Liberar usuários somente após aceite do responsável.

## Gatilhos de reversão

- qualquer acesso cruzado entre empresas;
- perda, duplicação ou divergência de registros;
- falha persistente de autenticação, upload ou download;
- erro ou throttling que impeça operação normal;
- ausência de evidência auditável para uma gravação.

## Reversão

1. Suspender novas gravações e registrar horário/escopo.
2. Reativar Supabase como backend do frontend.
3. Exportar o delta AWS da janela e preservá-lo, sem sobrescrever produção.
4. Reconciliar o delta e aplicar somente após revisão humana.
5. Registrar incidente, causa, impacto e ação corretiva antes de novo corte.

## Evidências de aceite

Guardar commit, horários, responsáveis, contagens, hashes, resultados dos testes,
capturas dos alarmes e decisão final. Nunca guardar tokens, senhas, JWTs ou dados
integrais de comprovantes no repositório.
