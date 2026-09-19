import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchObligationRules() {
  if (isAwsDataBackend()) return (await awsData.list('obligation_rules')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const { data, error } = await supabase.from('obligation_rules').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createObligationRule(rule) {
  if (isAwsDataBackend()) return awsData.create('obligation_rules', rule);
  const { data, error } = await supabase.from('obligation_rules').insert(withCurrentWorkspace(rule)).select().single();
  if (error) throw error;
  return data;
}

export async function updateObligationRule(id, patch) {
  if (isAwsDataBackend()) return awsData.update('obligation_rules', id, patch);
  const { data, error } = await supabase.from('obligation_rules').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteObligationRule(id) {
  if (isAwsDataBackend()) return awsData.remove('obligation_rules', id);
  const { error } = await supabase.from('obligation_rules').delete().eq('id', id);
  if (error) throw error;
}
