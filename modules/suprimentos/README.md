# Módulo Suprimentos — OrçaFácil

Fonte funcional preservada: `e3isolucoes/gestao-compras@c5c1926e288b446d629c0a1d451aeb4f40c79319`.

## Objetivo da integração

Trazer o OrçaFácil para o catálogo do E3I Negócios Inteligentes sem reescrever sua lógica de decisão. A mudança desta etapa é deliberadamente concentrada na persistência:

- lógica de ranking, TCO, risco, sensibilidade e estruturação: preservada;
- interface: incorporada como módulo da plataforma;
- D1 `analyses`: substituído pelo `GenericRepository`;
- autenticação: sessão Cognito já usada pela plataforma;
- acesso comercial: `ENTITLEMENT#suprimentos`.

## Modelo RECORD

Cada análise hoje persistida na tabela D1 `analyses` passa a ser:

```text
PK = WORKSPACE#<workspaceId>
SK = RECORD#suprimentos#pedido-compra#<recordId>

module_id   = suprimentos
record_type = pedido-compra
record_id   = <uuid>
```

Campos de negócio preservados:

| OrçaFácil / D1 | RECORD |
| --- | --- |
| description | description |
| budget | budget |
| deadline | deadline |
| location | location |
| quantity | quantity |
| preferences | preferences |
| constraints_text | constraints |
| criteria_json | criteria |
| alternatives_json | alternatives |

Os campos permanecem strings porque esse é o contrato atual do produto. A integração não promove, estima ou converte valores implicitamente.

## Relação com Obrigações

Exemplo real coberto por teste:

```text
RECORD#suprimentos#pedido-compra#pedido-150k
  -- gera-obrigacao-fiscal -->
RECORD#obrigacoes#activity#retencao-pedido-150k
```

A relação é bidirecional dentro do mesmo workspace e consultável por:

```text
GSI-RECORD-LOOKUP
PK = RECORD#pedido-150k
SK begins_with RELATION#
```

A consulta retorna metadados suficientes para identificar o domínio relacionado:

```json
{
  "relation_type": "gera-obrigacao-fiscal",
  "related_module_id": "obrigacoes",
  "related_record_type": "activity",
  "related_record_id": "retencao-pedido-150k"
}
```

## Entitlement

O módulo só aparece no catálogo e só grava RECORDs quando o workspace possui:

```text
PK = WORKSPACE#<workspaceId>
SK = ENTITLEMENT#suprimentos
status = ativo
```

O entitlement de `obrigacoes` é adicionalmente exigido quando uma relação fiscal entre os dois módulos é criada.
