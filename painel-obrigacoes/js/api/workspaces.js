import { supabase } from '../supabaseClient.js';
import { awsRequest, isAwsDataBackend } from './awsDataClient.js';

const versions = new Map();
const remember = (workspace) => { if (workspace?.id) versions.set(workspace.id, workspace.version); return workspace; };
const usesAwsAdministration = () => isAwsDataBackend() || globalThis.E3I_CONFIG?.authBackend === 'cognito';

export async function fetchWorkspaces() {
  if (usesAwsAdministration()) {
    const rows = []; let cursor;
    do { const page = await awsRequest(`admin/workspaces?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); rows.push(...page.items.map(remember)); cursor = page.cursor; } while (cursor);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await supabase.from('workspaces').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createWorkspace(payload) {
  if (usesAwsAdministration()) return remember(await awsRequest('admin/workspaces', { method: 'POST', body: payload }));
  const { data, error } = await supabase.from('workspaces').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateWorkspace(id, patch) {
  if (usesAwsAdministration()) return remember(await awsRequest(`admin/workspaces/${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...patch, version: versions.get(id) } }));
  const { data, error } = await supabase.from('workspaces').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
