ARG BASE_IMAGE=acre3i431811.azurecr.io/e3i-portal@sha256:04d63f77dbd8fef806a9b19601909b10901f2e8f0a4558df22a93bdeed4b3fb1
FROM ${BASE_IMAGE}

COPY session-probe-middleware.cjs /app/dist/session-probe-middleware.cjs
COPY patch-session-probe.cjs /tmp/patch-session-probe.cjs
COPY client-tool-auth.js /app/dist/client-tool-auth.js
COPY patch-client-tool-auth.cjs /tmp/patch-client-tool-auth.cjs
COPY first-login.js /app/dist/first-login.js
COPY first-login.css /app/dist/first-login.css
COPY first-login-server-snippet.txt /tmp/first-login-server-snippet.txt
COPY patch-first-login.cjs /tmp/patch-first-login.cjs
COPY test-first-login.cjs /tmp/test-first-login.cjs

COPY admin-central.html /app/private/admin-central.html
COPY admin-central.css /app/dist/admin-central.css
COPY admin-central.js /app/dist/admin-central.js
COPY admin-central-server-snippet.txt /tmp/admin-central-server-snippet.txt
COPY patch-admin-central.cjs /tmp/patch-admin-central.cjs
COPY test-admin-central.cjs /tmp/test-admin-central.cjs
COPY admin-users-server-snippet.txt /tmp/admin-users-server-snippet.txt
COPY patch-admin-users.cjs /tmp/patch-admin-users.cjs
COPY test-admin-users.cjs /tmp/test-admin-users.cjs
COPY migrate-gra-users.cjs /app/migrate-gra-users.cjs

RUN node /tmp/patch-session-probe.cjs \
 && node /tmp/patch-client-tool-auth.cjs \
 && node /tmp/patch-first-login.cjs \
 && node /tmp/patch-admin-central.cjs \
 && node /tmp/patch-admin-users.cjs \
 && node --check /app/dist/server.cjs \
 && node --check /app/dist/admin-central.js \
 && node --check /app/migrate-gra-users.cjs \
 && node --check /app/dist/session-probe-middleware.cjs \
 && node --check /app/dist/client-tool-auth.js \
 && node --check /app/dist/first-login.js \
 && E3I_FIRST_LOGIN_DIR=/app/dist node /tmp/test-first-login.cjs \
 && E3I_ADMIN_DIR=/app/dist E3I_ADMIN_HTML=/app/private/admin-central.html E3I_ADMIN_PATCH_SCRIPT=/tmp/patch-admin-central.cjs E3I_ADMIN_SNIPPET=/tmp/admin-central-server-snippet.txt node /tmp/test-admin-central.cjs \
 && E3I_ADMIN_DIR=/app/dist E3I_ADMIN_USERS_PATCH_SCRIPT=/tmp/patch-admin-users.cjs E3I_ADMIN_USERS_SNIPPET=/tmp/admin-users-server-snippet.txt node /tmp/test-admin-users.cjs \
 && grep -Fq 'E3I_ANONYMOUS_SESSION_PROBE_V3' /app/dist/server.cjs \
 && grep -Fq 'session-probe-middleware.cjs' /app/dist/server.cjs \
 && grep -Fq 'E3I_CLIENT_TOOL_AUTH_BRIDGE_V1' /app/dist/client-tool-auth.js \
 && grep -Fq '/client-tool-auth.js' /app/dist/index.html \
 && grep -Fq '/first-login.js' /app/dist/index.html \
 && grep -Fq 'PASSWORD_CHANGE_REQUIRED' /app/dist/server.cjs \
 && grep -Fq 'res.status(428)' /app/dist/server.cjs \
 && grep -Fq '/api/auth/first-login/complete' /app/dist/server.cjs \
 && test -s /app/private/admin-central.html \
 && test -s /app/dist/admin-central.css \
 && test -s /app/dist/admin-central.js \
 && grep -Fq 'E3I_ADMIN_CENTRAL_PATCH_V1' /app/dist/server.cjs \
 && grep -Fq 'E3I_ADMIN_USERS_PATCH_V1' /app/dist/server.cjs \
 && grep -Fq "app.get('/api/admin/access'" /app/dist/server.cjs \
 && grep -Fq "app.get('/admin-central.html'" /app/dist/server.cjs \
 && grep -Fq '/api/admin/organizations/:organizationId/client-tools/:toolId' /app/dist/server.cjs \
 && grep -Fq '/api/admin/organizations/:organizationId/users' /app/dist/server.cjs

LABEL e3i.portal.source="e3isolucoes/negocios_inteligentes" \
      e3i.portal.fix="anonymous-session-probe-v3,client-tool-auth-bridge-v1,admin-central-v1,admin-users-v1,existing-user-reconciliation-v1,first-login-v1"


CMD ["sh", "-c", "node /app/migrate-gra-users.cjs && exec node /app/dist/server.cjs"]
