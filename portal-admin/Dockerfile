ARG BASE_IMAGE=acre3i431811.azurecr.io/e3i-portal@sha256:04d63f77dbd8fef806a9b19601909b10901f2e8f0a4558df22a93bdeed4b3fb1
FROM ${BASE_IMAGE}

COPY session-probe-middleware.cjs /app/dist/session-probe-middleware.cjs
COPY patch-session-probe.cjs /tmp/patch-session-probe.cjs
COPY client-tool-auth.js /app/dist/client-tool-auth.js
COPY patch-client-tool-auth.cjs /tmp/patch-client-tool-auth.cjs

RUN node /tmp/patch-session-probe.cjs \
 && node /tmp/patch-client-tool-auth.cjs \
 && node --check /app/dist/server.cjs \
 && node --check /app/dist/session-probe-middleware.cjs \
 && node --check /app/dist/client-tool-auth.js \
 && grep -Fq 'E3I_ANONYMOUS_SESSION_PROBE_V3' /app/dist/server.cjs \
 && grep -Fq 'session-probe-middleware.cjs' /app/dist/server.cjs \
 && grep -Fq 'E3I_CLIENT_TOOL_AUTH_BRIDGE_V1' /app/dist/client-tool-auth.js \
 && grep -Fq '/client-tool-auth.js' /app/dist/index.html

LABEL e3i.portal.source="e3isolucoes/negocios_inteligentes" \
      e3i.portal.fix="anonymous-session-probe-v3,client-tool-auth-bridge-v1"
