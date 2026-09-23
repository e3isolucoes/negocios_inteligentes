'use strict';

const ANONYMOUS_PAYLOAD = Object.freeze({
  authenticated: false,
  user: null,
  session: null,
});

function isSessionProbe(req) {
  return req?.method === 'GET' && req?.path === '/api/auth/session';
}

module.exports = function e3iAnonymousSessionProbe(req, res, next) {
  if (!isSessionProbe(req)) return next();

  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  const originalWriteHead = typeof res.writeHead === 'function' ? res.writeHead.bind(res) : null;

  let explicitUnauthorized = false;

  const shouldNormalize = () => explicitUnauthorized || Number(res.statusCode) === 401;
  const markStatus = (code) => {
    explicitUnauthorized = Number(code) === 401;
    return code;
  };
  const normalizeStatus = () => {
    explicitUnauthorized = false;
    originalStatus(200);
  };

  res.status = (code) => originalStatus(markStatus(code));

  res.json = (payload) => {
    if (!shouldNormalize()) return originalJson(payload);
    normalizeStatus();
    return originalJson(ANONYMOUS_PAYLOAD);
  };

  res.send = (payload) => {
    if (!shouldNormalize()) return originalSend(payload);
    normalizeStatus();
    return originalJson(ANONYMOUS_PAYLOAD);
  };

  res.end = (...args) => {
    if (!shouldNormalize()) return originalEnd(...args);
    normalizeStatus();
    return originalJson(ANONYMOUS_PAYLOAD);
  };

  if (originalWriteHead) {
    res.writeHead = (statusCode, ...args) => {
      markStatus(statusCode);
      return originalWriteHead(Number(statusCode) === 401 ? 200 : statusCode, ...args);
    };
  }

  return next();
};
