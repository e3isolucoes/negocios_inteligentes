# Segurança e LGPD — E3I Intelligence

A fundação segue privacy and security by design. A definição jurídica da base de tratamento, dos papéis das partes e dos prazos específicos deve ser validada para cada finalidade real.

## Controles obrigatórios

- minimização: coletar somente o necessário;
- `tenantId` obrigatório e isolamento no backend e no armazenamento;
- proveniência obrigatória para distinguir informação medida, declarada, extraída, calculada, prevista ou inferida;
- classificação de dados e finalidade registrada;
- menor privilégio e segregação de funções;
- criptografia em trânsito e em repouso;
- retenção por categoria;
- auditoria separada de logs técnicos;
- evidências por referência privada, sem conteúdo bruto nos contratos;
- conteúdo de clientes não utilizado para treinamento de modelos por padrão;
- agentes iniciam somente leitura e ações futuras passam por autorização e política de risco.

## Classificação v1

`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `PERSONAL_DATA`, `SENSITIVE_PERSONAL_DATA` e `RESTRICTED`.

Quando houver dado pessoal, o registro de proveniência deve apontar a finalidade e uma referência de governança aprovada. O software não escolhe automaticamente a base de tratamento.

## Retenção v1

`EPHEMERAL_30D`, `OPERATIONAL_1Y`, `ANALYTICS_2Y`, `AUDIT_POLICY` e `CUSTOM_POLICY`.

As classes são referências técnicas; a aplicação da política depende da finalidade e das obrigações aplicáveis.

## Isolamento por tenant

- todos os contratos de negócio carregam `tenantId`;
- APIs futuras filtram e autorizam no backend;
- armazenamento, cache, índices e auditoria devem manter o mesmo isolamento;
- não haverá busca vetorial global entre clientes.

## Evidências e logs

O contrato de evidência guarda referência privada e hash de integridade, não conteúdo bruto. Logs técnicos devem privilegiar identificadores, ação, resultado e timestamp e evitar cópia desnecessária de conteúdo de negócio.

## IA e agentes

Resultados de modelos nunca são apresentados como fatos medidos. Contexto enviado a modelos deve ser minimizado quando identificação não for necessária. Conteúdo do cliente não compõe conjunto de treinamento por padrão.

Ação futura de agente deve obedecer à interseção entre permissão do usuário, permissão da ferramenta do agente e policy engine. A Sprint 1 não habilita ações de escrita.

## Resiliência

Desligar o E3I Intelligence ou sua ingestão não pode impedir o funcionamento do Portal ou de qualquer ferramenta operacional existente. A regra EventBridge nasce desabilitada e a feature flag nasce desligada.
