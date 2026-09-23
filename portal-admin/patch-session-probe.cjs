const fs = require('fs');

const serverPath = process.env.E3I_PORTAL_SERVER || '/app/dist/server.cjs';
let source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes('E3I_ANONYMOUS_SESSION_PROBE_V3')) {
  const routeRegex = /app\.get\((["'])\/api\/auth\/session\1/;
  const match = source.match(routeRegex);
  if (!match) throw new Error('GET /api/auth/session route not found');

  const injection = [
    '  // E3I_ANONYMOUS_SESSION_PROBE_V3',
    '  app.use(require("./session-probe-middleware.cjs"));',
    '',
  ].join('\n');

  const at = source.indexOf(match[0]);
  source = source.slice(0, at) + injection + source.slice(at);
  fs.writeFileSync(serverPath, source, 'utf8');
}

console.log('E3I_PORTAL_AUTH_SESSION_PROBE_PATCH_OK');
