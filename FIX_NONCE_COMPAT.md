# Hotfix de compatibilidade Portal → Painel de Obrigações

## Causa confirmada

A API AWS passou a exigir nonce criptográfico no provisionamento interno, mas o
backend do Portal E3I implantado ainda chama a integração no contrato anterior,
sem `x-e3i-nonce`. O resultado é `401 REQUEST_REJECTED` na Lambda com a mensagem
`Nonce criptográfico obrigatório ou inválido`, que o Portal expõe ao navegador
como `502` no endpoint `/api/client-tools/painel-obrigacoes/launch`.

## Hotfix aplicado

`painel-obrigacoes/aws/api/src/portal-provisioning.mjs` agora mantém o contrato
novo como preferencial:

- `x-e3i-timestamp`
- `x-e3i-nonce` (32–128 caracteres base64url/UUID-safe)
- `x-e3i-signature = HMAC_SHA256(secret, timestamp.nonce.rawBody)`

Para o Portal já implantado, a API aceita temporariamente a assinatura antiga:

`HMAC_SHA256(secret, timestamp.rawBody)`

A compatibilidade **não desativa a proteção contra replay**: uma chave de replay
é derivada deterministicamente de timestamp + assinatura + corpo e continua
sendo consumida uma única vez no DynamoDB com TTL.

## Validação

- `node --check` passou para o módulo e para o teste alterados.
- A chave sintética gerada possui 43 caracteres base64url e satisfaz o mesmo
  padrão de nonce.
- O ambiente desta correção não tinha acesso ao npm registry, então a suíte que
  depende dos pacotes AWS SDK não pôde ser executada localmente. O workflow do
  GitHub deve executar os testes completos antes do deploy.

## Próximo passo definitivo

Atualizar o backend do Portal E3I para gerar um nonce novo por tentativa e
assinar exatamente `timestamp.nonce.rawBody`. Depois que esse deploy estiver
confirmado, remover a compatibilidade legada da API AWS.
