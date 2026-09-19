import { getAccessToken } from './auth.js';
import { STATE } from '../state.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let requestQueue = Promise.resolve();

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

async function request(path, { method = 'GET', body } = {}) {
  const API_BASE = awsApiBase();
  if (!API_BASE) throw new Error('Backend AWS ainda não foi configurado.');
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Sua sessão expirou. Entre novamente.');
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForApiSlot();
    response = await fetch(`${API_BASE}/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(STATE.profile?.workspace_id ? { 'x-workspace-id': STATE.profile.workspace_id } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store'
    });
    if (response.status !== 429) break;
    await sleep(500 * (attempt + 1));
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'Falha ao acessar o serviço.'), { status: response.status, requestId: payload.requestId });
  return payload;
}

export const awsData = Object.freeze({
  listPage: (entity, { limit = 100, cursor } = {}) => request(`${entity}?limit=${encodeURIComponent(limit)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  list: async (entity) => {
    const records = [];
    let cursor;
    do {
      const page = await request(`${entity}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (Array.isArray(page)) return page;
      records.push(...(page.items || []));
      cursor = page.cursor;
    } while (cursor);
    return records;
  },
  get: (entity, id) => request(`${entity}/${encodeURIComponent(id)}`),
  create: (entity, values) => request(entity, { method: 'POST', body: values }),
  update: (entity, id, values) => request(`${entity}/${encodeURIComponent(id)}`, { method: 'PATCH', body: values }),
  remove: (entity, id) => request(`${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadUrl: (values) => request('files/upload-url', { method: 'POST', body: values }),
  downloadUrl: (path) => request('files/download-url', { method: 'POST', body: { path } }),
  me: () => request('me')
});
