import { supabase } from '../supabaseClient.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchProfiles() {
  if (isAwsDataBackend()) return (await awsData.list('profiles')).sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  const { data, error } = await supabase.from('profiles').select('*').order('email');
  if (error) throw error;
  return data;
}

// Só admin consegue alterar o papel de outra pessoa (RLS: profiles_update_admin_or_self
// + gatilho prevent_self_role_escalation no banco). Também permite ajustar o
// nome de exibição, se precisar corrigir algo.
export async function updateProfile(id, patch) {
  if (isAwsDataBackend()) return awsData.update('profiles', id, patch);
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
