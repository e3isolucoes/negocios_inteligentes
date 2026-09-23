import { IntelligenceError } from './mapping-core.mjs';
import { assertMappingRepository } from './mapping-repository.mjs';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8' });
const RESERVED_CLIENT_FIELDS = new Set(['tenantId', 'actorId', 'permissions', 'auth', 'context']);

function response(status, body) {
  return { status, headers: { ...JSON_HEADERS }, body };
}

function normalizePath(input) {
  const raw = String(input ?? '/').split('?')[0] || '/';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function bodyByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function parseBody(request, maxBodyBytes) {
  let raw;
  if (typeof request.rawBody === 'string') {
    raw = request.rawBody;
  } else if (typeof request.body === 'string') {
    raw = request.body;
  } else if (request.body === undefined || request.body === null) {
    return {};
  } else {
    try {
      raw = JSON.stringify(request.body);
    } catch {
      throw new IntelligenceError('INVALID_JSON', 'Request body must be valid JSON', 400);
    }
  }

  if (bodyByteLength(raw) > maxBodyBytes) {
    throw new IntelligenceError('PAYLOAD_TOO_LARGE', 'Request body exceeds the allowed size', 413);
  }

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new IntelligenceError('INVALID_JSON', 'Request body must be valid JSON', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new IntelligenceError('INVALID_BODY', 'Request body must be a JSON object', 400);
  }

  for (const field of RESERVED_CLIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(parsed, field)) {
      throw new IntelligenceError(
        'SECURITY_CONTEXT_FROM_CLIENT_FORBIDDEN',
        `${field} must be derived from the authenticated server context`,
        400,
      );
    }
  }

  return parsed;
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new IntelligenceError('INVALID_PATH', 'Invalid request path', 400);
  }
}

function methodNotAllowed() {
  return response(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
}

function routeNotFound() {
  return response(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
}

function toErrorResponse(error) {
  if (error instanceof IntelligenceError) {
    return response(error.status || 400, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  return response(500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}

export function createMappingApi({ core, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  if (!core || typeof core !== 'object') throw new TypeError('MappingCore instance is required');
  assertMappingRepository(core.repository);
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) {
    throw new TypeError('maxBodyBytes must be an integer >= 1024');
  }

  return {
    async handle(request = {}) {
      try {
        const method = String(request.method ?? 'GET').toUpperCase();
        const path = normalizePath(request.path);
        const auth = request.auth;

        if (path === '/v1/mappings') {
          if (method === 'GET') {
            return response(200, { items: core.listMappings(auth) });
          }
          if (method === 'POST') {
            const mapping = core.createMapping(auth, parseBody(request, maxBodyBytes));
            return response(201, mapping);
          }
          return methodNotAllowed();
        }

        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 3 && parts[0] === 'v1' && parts[1] === 'mappings') {
          const mappingId = decodeSegment(parts[2]);

          if (parts.length === 3) {
            if (method !== 'GET') return methodNotAllowed();
            return response(200, core.getMapping(auth, mappingId));
          }

          if (parts.length === 4 && parts[3] === 'activities') {
            if (method !== 'POST') return methodNotAllowed();
            const mapping = core.addHumanActivity(auth, mappingId, parseBody(request, maxBodyBytes));
            return response(201, mapping);
          }

          if (parts.length === 4 && parts[3] === 'facts') {
            if (method !== 'POST') return methodNotAllowed();
            const mapping = core.addHumanFact(auth, mappingId, parseBody(request, maxBodyBytes));
            return response(201, mapping);
          }
        }

        return routeNotFound();
      } catch (error) {
        return toErrorResponse(error);
      }
    },
  };
}
