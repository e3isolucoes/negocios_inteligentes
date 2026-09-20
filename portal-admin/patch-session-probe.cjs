const fs = require('fs');

const serverPath = process.env.E3I_PORTAL_SERVER || '/app/dist/server.cjs';
let source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes('E3I_ANONYMOUS_SESSION_PROBE_V2')) {
  const routeRegex = /app\.get\((["'])\/api\/auth\/session\1/;
  const match = source.match(routeRegex);
  if (!match) throw new Error('GET /api/auth/session route not found');

  const middleware = [
    '  // E3I_ANONYMOUS_SESSION_PROBE_V2',
    '  app.use((req, res, next) => {',
    '    if (req.method !== "GET" || req.path !== "/api/auth/session") return next();',
    '    const originalStatus = res.status.bind(res);',
    '    const originalJson = res.json.bind(res);',
    '    const originalSend = res.send.bind(res);',
    '    const originalEnd = res.end.bind(res);',
    '    let anonymousProbe = false;',
    '    const anonymousPayload = { authenticated: false, user: null, session: null };',
    '    res.status = (code) => {',
    '      anonymousProbe = Number(code) === 401;',
    '      return originalStatus(anonymousProbe ? 200 : code);',
    '    };',
    '    res.json = (payload) => originalJson(anonymousProbe ? anonymousPayload : payload);',
    '    res.send = (payload) => originalSend(anonymousProbe ? JSON.stringify(anonymousPayload) : payload);',
    '    res.end = (...args) => anonymousProbe',
    '      ? originalJson(anonymousPayload)',
    '      : originalEnd(...args);',
    '    next();',
    '  });',
    '',
  ].join('\n');

  const at = source.indexOf(match[0]);
  source = source.slice(0, at) + middleware + source.slice(at);
  fs.writeFileSync(serverPath, source, 'utf8');
}

console.log('E3I_PORTAL_AUTH_SESSION_PROBE_PATCH_OK');
