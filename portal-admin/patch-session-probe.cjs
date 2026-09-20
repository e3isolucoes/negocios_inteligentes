const fs = require('fs');

const serverPath = process.env.E3I_PORTAL_SERVER || '/app/dist/server.cjs';
let source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes('E3I_ANONYMOUS_SESSION_PROBE_V1')) {
  const routeRegex = /app\.get\((["'])\/api\/auth\/session\1/;
  const match = source.match(routeRegex);
  if (!match) throw new Error('GET /api/auth/session route not found');

  const middleware = [
    '  // E3I_ANONYMOUS_SESSION_PROBE_V1',
    '  app.use("/api/auth/session", (req, res, next) => {',
    '    if (req.method !== "GET") return next();',
    '    const originalStatus = res.status.bind(res);',
    '    const originalJson = res.json.bind(res);',
    '    let anonymousProbe = false;',
    '    res.status = (code) => {',
    '      anonymousProbe = Number(code) === 401;',
    '      return originalStatus(anonymousProbe ? 200 : code);',
    '    };',
    '    res.json = (payload) => originalJson(anonymousProbe',
    '      ? { authenticated: false, user: null, session: null }',
    '      : payload);',
    '    next();',
    '  });',
    '',
  ].join('\n');

  const at = source.indexOf(match[0]);
  source = source.slice(0, at) + middleware + source.slice(at);
  fs.writeFileSync(serverPath, source, 'utf8');
}

console.log('E3I_PORTAL_AUTH_SESSION_PROBE_PATCH_OK');
