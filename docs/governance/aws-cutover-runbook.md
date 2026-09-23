# Runbook de corte — Painel de Obrigações para AWS

## Princípios

- Produção permanece no Supabase até aprovação explícita.
- Não existe corte com migração parcial, diferença de contagem ou teste de
  isolamento pendente.
- O primeiro corte é por ferramenta, nunca por toda a plataforma ao mesmo tempo.
- Supabase fica em leitura durante a janela de reversão; não é removido no dia do corte.

## Critérios de entrada

- CI verde e commit identificado;
- Lambda, DynamoDB, S3, orçamento e logs saudáveis;
- reconciliação com zero diferença por entidade e empresa;
- dois usuários de empresas distintas testados, sem leitura cruzada;
- CRUD, anexar, visualizar, concluir, desfazer e excluir validados;
- backup/exportação com hash e restauração testada em ambiente isolado;
- responsável, janela, comunicação e decisão de rollback definidos.

## Sequência de corte

1. Congelar gravações no Supabase e registrar horário.
2. Fazer exportação final e copiar somente o delta validado.
3. Reconciliar contagens e amostras por `workspace_id`.
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
