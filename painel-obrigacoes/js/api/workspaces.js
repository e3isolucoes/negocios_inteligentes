import { supabase } from '../supabaseClient.js';

export async function fetchWorkspaces() {
  const { data, error } = await supabase.from('workspaces').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createWorkspace(payload) {
  const { data, error } = await supabase.from('workspaces').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateWorkspace(id, patch) {
  const { data, error } = await supabase.from('workspaces').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
