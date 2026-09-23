# Correção CSP — 2026-09-08

## Problema
O navegador reportava `Content Security Policy of your site blocks the use of eval in JavaScript`.
O frontend não possui chamadas diretas a `eval()`, `new Function()` ou timers com strings.
O OCR usa Tesseract.js, cujo núcleo executa WebAssembly. Com uma CSP que contém
`script-src`, a compilação WebAssembly precisa ser permitida explicitamente.

## Correção aplicada
- `script-src` permite `'unsafe-eval'`, necessário para as otimizações em tempo
  de execução das bibliotecas de leitura de documentos usadas pelo painel.
- `script-src-elem` restringe o carregamento de scripts a `self` e ao jsDelivr.
  Scripts inline e URLs não autorizadas continuam bloqueados mesmo com a
  compatibilidade de execução dinâmica habilitada.
- `worker-src` continua permitindo apenas `self`, jsDelivr e `blob:`.
- Todos os imports locais receberam a versão `20260908-csp-wasm-v2` para evitar
  reutilização de módulos antigos no navegador/CDN.
- `sw.js` recebeu `Cache-Control: no-cache, no-store, must-revalidate`.
- `runtime-config.js` registra eventos `securitypolicyviolation` no console com o
  prefixo `[E3I CSP]`, mostrando diretiva, URI bloqueada, arquivo e linha.

## Após publicar
No DevTools > Network, abra o documento principal e confirme no response header:

`Content-Security-Policy: ... script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net; script-src-elem 'self' https://cdn.jsdelivr.net; ...`

Se o servidor ainda responder com a política anterior, o ZIP novo não está sendo
servido pela implantação atual ou existe outro proxy/CDN sobrescrevendo o header.
