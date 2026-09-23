# ADR-PLATFORM-001 — Arquitetura híbrida de baixo custo

- Status: aceita
- Data: 23/08/2026
- Responsável: E3I Soluções

## Decisão

Hospedar o frontend e a API HTTP no Azure Static Web Apps Free e manter banco,
autenticação, RLS e arquivos no Supabase Free enquanto a operação estiver em
validação comercial.

O inventário dos recursos provisionados e dos locais autorizados para segredos
fica em `docs/governance/platform-inventory.md`.

## Motivo

O uso atual é pequeno: banco com aproximadamente 15 MB, Storage com 17,5 MB e
sete contas. Autogerenciar toda a pilha Supabase numa VM Azure de 4 GB aumentaria
custo e risco operacional. Reescrever Auth, Storage e RLS para serviços Azure
criaria risco funcional sem benefício proporcional nesta fase.

## Limites e gatilhos de revisão

A decisão deve ser revista quando ocorrer qualquer condição:

- banco atingir 350 MB ou Storage atingir 700 MB;
- egress mensal atingir 3,5 GB;
- necessidade contratual de SLA, backup automático ou suporte;
- primeiro cliente pagante com requisito de disponibilidade;
- incidente de indisponibilidade relevante causado por pausa ou quota;
- necessidade de segregação física por cliente ou requisito regulatório.

## Próximo estágio preferencial

Primeiro avaliar Supabase Pro, pois preserva a arquitetura e remove pausa por
inatividade. Migração integral para Azure exige estudo específico de PostgreSQL,
Blob Storage, identidade, RLS e custo total de operação.
