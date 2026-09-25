import { getAccessToken, getActiveWorkspaceId, refreshAccessToken } from './auth.js';
import { STATE } from '../state.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let requestQueue = Promise.resolve();
const versions = new Map();

function remember(entity, record) {
  if (!record?.id) return record;
  const version = Number.isInteger(record.version) && record.version > 0 ? record.version : 1;
  versions.set(`${entity}:${record.id}`, version);
  return Number.isInteger(record.version) && record.version > 0
    ? record
    : { ...record, version };
}

function waitForApiSlot() {
  const slot = requestQueue.then(() => sleep(1100));
  requestQueue = slot.catch(() => {});
  return slot;
}

export function isAwsDataBackend() {
  return globalThis.E3I_CONFIG?.dataBackend === 'aws';
}

export function awsApiBase() {
  return (globalThis.E3I_CONFIG?.awsApiBase || '').replace(/\/$/, '');
}

export async function awsRequest(path, { method = 'GET', body } = {}) {
  const API_BASE = awsApiBase();
  if (!API_BASE) throw new Error('Backend AWS ainda não foi configurado.');
  let accessToken = await getAccessToken();
  let workspaceId = await getActiveWorkspaceId() || STATE.profile?.workspace_id;
  if (!accessToken) {
    throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401, code: 'session_expired' });
  }
  let response;
  let authRetried = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForApiSlot();
    try {
      response = await fetch(`${API_BASE}/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          ...(workspaceId ? { 'x-workspace-id': workspaceId } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (cause) {
      if (method === 'GET' && attempt < 2) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      throw Object.assign(
        new Error('Não foi possível conectar ao serviço da ferramenta. Tente novamente; se persistir, use Atualizar para restabelecer a conexão.'),
        { status: 0, code: 'service_unreachable', cause },
      );
    }
    if (response.status === 401 && !authRetried) {
      authRetried = true;
      try {
        accessToken = await refreshAccessToken();
        workspaceId = await getActiveWorkspaceId() || STATE.profile?.workspace_id;
      } catch (cause) {
        throw Object.assign(
          new Error('Sua sessão expirou. Entre novamente.'),
          { status: 401, code: 'session_expired', cause },
        );
      }
      if (!accessToken) {
        throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401, code: 'session_expired' });
      }
      continue;
    }
    if (response.status !== 429) break;
    await sleep(500 * (attempt + 1));
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Falha ao acessar o serviço.'), { status: response.status, requestId: payload.requestId });
  return payload;
}

export const awsData = Object.freeze({
  listPage: async (entity, { limit = 100, cursor } = {}) => {
    const page = await awsRequest(`${entity}?limit=${encodeURIComponent(limit)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const record of page.items || []) remember(entity, record);
    return page;
  },
  list: async (entity) => {
    const records = [];
    let cursor;
    do {
      const page = await awsRequest(`${entity}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (Array.isArray(page)) return page;
      records.push(...(page.items || []).map(record => remember(entity, record)));
      cursor = page.cursor;
    } while (cursor);
    return records;
  },
  get: async (entity, id) => remember(entity, await awsRequest(`${entity}/${encodeURIComponent(id)}`)),
  create: async (entity, values) => remember(entity, await awsRequest(entity, { method: 'POST', body: values })),
  update: async (entity, id, values) => {
    const key = `${entity}:${id}`;
    if (!versions.has(key)) remember(entity, await awsRequest(`${entity}/${encodeURIComponent(id)}`));
    return remember(entity, await awsRequest(`${entity}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...values, version: versions.get(key) } }));
  },
  remove: (entity, id) => awsRequest(`${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadUrl: (values) => awsRequest('files/upload-url', { method: 'POST', body: values }),
  downloadUrl: (path) => awsRequest('files/download-url', { method: 'POST', body: { path } }),
  me: () => awsRequest('me')
});
