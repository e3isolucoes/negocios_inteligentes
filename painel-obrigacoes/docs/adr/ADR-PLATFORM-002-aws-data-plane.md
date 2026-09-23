# ADR-PLATFORM-002 — Plano de dados AWS governado

- Status: em validação de staging
- Data: 25/08/2026
- Responsável: E3I Soluções

## Decisão

Validar DynamoDB e S3 como plano de dados do Painel de Obrigações, mantendo o
frontend no Azure Static Web Apps e, temporariamente, o Supabase Auth como
emissor de identidade. Produção continua no Supabase até o checklist de corte
ser aprovado.

Cada ferramenta e ambiente possui tabela, bucket e função próprios. Cada
empresa é isolada por partição `workspace_id`; o cabeçalho de seleção só é
aceito quando existe uma associação ativa do usuário com aquela empresa.

## Motivos

- separar custo, acesso e ciclo de vida por ferramenta;
- operar dentro das franquias disponíveis enquanto não há receita;
- evitar credenciais AWS no navegador;
- preservar reversão para o Supabase durante a validação.

## Controles obrigatórios

- MFA e função temporária de deploy com privilégio mínimo;
- S3 privado, criptografado, versionado e acessado por URLs de cinco minutos;
- auditoria transacional para gravações DynamoDB;
- proteção contra exclusão e PITR no ambiente `prod`;
- orçamento, alarmes, reconciliação por empresa e teste de restauração;
- nenhum corte se houver diferença de contagem, erro de isolamento ou falha de
  comprovante.

## Consequências

O modelo reduz custo inicial, mas exige disciplina operacional entre Azure,
AWS e Supabase Auth. A retirada futura do Supabase Auth será uma decisão
separada; não faz parte deste corte de dados.
