# Mapping API v1

A API desta etapa é um adaptador isolado sobre o `MappingCore`. Ela não está publicada, não possui deploy automático e não é dependência do Portal, Painel de Obrigações ou demais ferramentas.

## Rotas do contrato

- `POST /v1/mappings` — cria mapeamento do zero;
- `GET /v1/mappings` — lista mapeamentos do tenant autenticado;
- `GET /v1/mappings/:mappingId` — consulta um mapeamento do tenant autenticado;
- `POST /v1/mappings/:mappingId/activities` — adiciona atividade declarada por usuário;
- `POST /v1/mappings/:mappingId/facts` — adiciona fato declarado por usuário.

## Contexto de segurança

O adaptador de autenticação futuro deverá fornecer `request.auth` no servidor contendo `tenantId`, `actorId` e permissões já verificadas. Esses campos são proibidos no payload do cliente.

Recursos de outro tenant são consultados sempre pela chave do tenant autenticado. Portanto uma tentativa cross-tenant recebe o mesmo `404 NOT_FOUND` de um identificador inexistente.

Corpos de requisição são limitados por tamanho e erros internos inesperados são convertidos para resposta genérica, sem stack trace ou conteúdo de negócio.

## Persistência

`mapping-repository.mjs` formaliza o contrato mínimo `save/get/list` e a chave composta tenant + mapping. Nesta Sprint o `MappingCore` continua usando o adapter em memória para testes e desenvolvimento.

Não existe persistência durável nesta entrega. Um adapter DynamoDB será implementado separadamente, com criptografia, PITR, least privilege, tenant scoping e testes de integração antes de qualquer deploy.

## LGPD e proveniência

A API não permite ao cliente escolher `sourceType` para complementos humanos. A origem continua sendo definida no backend como `USER_DECLARED` e as regras existentes de classificação, finalidade, retenção e referência de base/governança permanecem obrigatórias.
