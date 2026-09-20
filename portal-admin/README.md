# Portal auth compatibility

Esta pasta concentra patches do Portal E3I mantidos no repositório canônico `e3isolucoes/negocios_inteligentes`.

## Sessão anônima

`patch-session-probe.cjs` ajusta somente `GET /api/auth/session` no bundle do Portal. Quando essa rota encontra ausência de sessão e responderia `401`, o patch normaliza o probe para:

```json
{
  "authenticated": false,
  "user": null,
  "session": null
}
```

Rotas protegidas continuam preservando `401/403`.

Uso em imagem do Portal:

```dockerfile
COPY portal-admin/patch-session-probe.cjs /tmp/patch-session-probe.cjs
RUN node /tmp/patch-session-probe.cjs
```

Teste local:

```bash
node portal-admin/test-session-probe.cjs
```
