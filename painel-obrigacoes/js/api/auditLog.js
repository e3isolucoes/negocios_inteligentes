import { supabase } from '../supabaseClient.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchAuditLog({ limit = 100 } = {}) {
  if (isAwsDataBackend()) return (await awsData.list('audit_log'))
    .sort((a, b) => (b.changed_at || b.created_at || '').localeCompare(a.changed_at || a.created_at || ''))
    .slice(0, limit);
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
