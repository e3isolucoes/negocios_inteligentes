# E3I Negócios Inteligentes

Plataforma modular da E3I Soluções para centralizar soluções de gestão empresarial em uma única experiência.

## Arquitetura atual

```text
/
├── index.html                       # entrada da plataforma
├── modules/
│   └── registry.js                  # contrato e catálogo central de módulos
├── platform/
│   ├── shell.js                     # navegação e ciclo de vida do módulo ativo
│   └── shell.css                    # identidade visual/layout da plataforma
├── painel-obrigacoes/               # primeiro módulo, preservado do produto atual
│   ├── index.html
│   ├── css/
│   ├── icons/
│   ├── js/
│   ├── manifest.json
│   └── sw.js
├── api/                             # função já existente usada pelo painel
└── staticwebapp.config.json         # configuração de publicação/CSP
```

## Módulos

A barra lateral **não possui módulos hardcoded no HTML**. O catálogo é definido exclusivamente em:

`modules/registry.js`

O primeiro módulo registrado é:

- `obrigacoes` — Painel de Obrigações.

Para incluir um novo produto na plataforma, registre seu contrato no catálogo central com `id`, `name`, `area`, `requiredEntitlement`, `mount(container, context)` e `unmount(container)`.

## Compatibilidade do Painel de Obrigações

Nesta etapa o Painel de Obrigações foi encapsulado como módulo sem reescrita das regras internas. Foram preservados:

- componentes e navegação próprios do painel;
- configuração AWS/Supabase existente;
- autenticação e SSO do Portal E3I;
- regras de acesso e permissões;
- clientes de dados;
- fluxos de administração, validação, relatórios e dashboard;
- service worker e manifest do módulo.

O shell apenas encaminha os parâmetros de autenticação necessários ao módulo e não altera schema, autenticação ou backend.

## Desenvolvimento

O shell é HTML/CSS/JavaScript puro e não exige build.

Para executar os testes estruturais do catálogo:

```bash
npm test
```

## Próximas evoluções

A estrutura foi preparada para novos módulos entrarem pelo registro central sem acoplar a navegação global às regras internas de cada produto.
