ARG BASE_IMAGE=acre3i431811.azurecr.io/e3i-portal@sha256:04d63f77dbd8fef806a9b19601909b10901f2e8f0a4558df22a93bdeed4b3fb1
FROM ${BASE_IMAGE}

COPY patch-session-probe.cjs /tmp/patch-session-probe.cjs

RUN node /tmp/patch-session-probe.cjs \
 && node --check /app/dist/server.cjs \
 && grep -Fq 'E3I_ANONYMOUS_SESSION_PROBE_V2' /app/dist/server.cjs

LABEL e3i.portal.source="e3isolucoes/negocios_inteligentes" \
      e3i.portal.fix="anonymous-session-probe-v2"
