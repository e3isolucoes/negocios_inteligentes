# ADR-PLATFORM-003 — Monólito modular com catálogo fechado

- Status: aceita
- Data: 30/08/2026
- Responsável: E3I Soluções

## Contexto

O Painel de Obrigações possui domínios que evoluem em ritmos diferentes:
operação, validação, comprovantes, relatórios, cadastros e administração.
O acoplamento atual em `data.js` e `render.js` aumenta o risco de regressão, mas
o volume e a equipe ainda não justificam microserviços.

## Decisão

Adotar um monólito modular implantado como um único frontend e um único backend
por ferramenta. Cada módulo usa contrato validado, identificador conhecido,
permissão declarada, função de renderização e ciclo de montagem opcional.

O catálogo é fechado no build. Não serão aceitos URLs de plugins, `eval`, scripts
de terceiros ou código fornecido por clientes. Personalização ocorre por
configuração e concessão de capacidades existentes.

## Fronteiras iniciais

- `obrigacoes`: carteira, ocorrências, checklist e comprovantes;
- `validacoes`: fila, aprovação e devolução;
- `relatorios`: consultas e exportações;
- `dashboard`: visão executiva;
- `administracao`: cadastros, equipe, regras e auditoria;
- `system-admin`: operação exclusiva da plataforma.

O frontend usa `enabledModules` por ambiente e `module_grants` por associação.
O backend repete a autorização por entidade; a interface nunca é a fronteira de
segurança. Ausência de `module_grants` preserva a instalação antiga; presença da
lista aplica negação por padrão.

## Consequências

Benefícios:

- mudanças localizadas e testáveis;
- habilitação gradual por empresa;
- menor custo operacional que microserviços;
- contratos explícitos para futura extração, se necessária.

Custos:

- migração incremental do arquivo `data.js`;
- necessidade de impedir dependências circulares entre módulos;
- concessões devem ser mantidas no backend e testadas em conjunto com papéis.

## Regras de evolução

1. Módulos dependem de portas compartilhadas, nunca de detalhes internos de outro módulo.
2. Integração entre módulos usa eventos ou casos de uso tipados.
3. Estado privado não é alterado diretamente por outro módulo.
4. Toda capacidade nova declara permissões, contratos, testes e telemetria.
5. Extração para serviço independente exige evidência de escala, isolamento ou equipe, não apenas preferência técnica.
