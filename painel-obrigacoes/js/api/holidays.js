import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchHolidays() {
  if (isAwsDataBackend()) return (await awsData.list('holidays')).sort((a, b) => (a.holiday_date || '').localeCompare(b.holiday_date || ''));
  const { data, error } = await supabase.from('holidays').select('*').order('holiday_date');
  if (error) throw error;
  return data;
}

export async function createHoliday({ date, name, scope = 'nacional' }) {
  if (isAwsDataBackend()) return awsData.create('holidays', { holiday_date: date, name, scope });
  const { data, error } = await supabase
    .from('holidays')
    .insert(withCurrentWorkspace({ holiday_date: date, name, scope }))
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHoliday(id) {
  if (isAwsDataBackend()) return awsData.remove('holidays', id);
  const { error } = await supabase.from('holidays').delete().eq('id', id);
  if (error) throw error;
}

// BrasilAPI é um serviço público gratuito e sem autenticação, mantido pela
// comunidade (não é do Supabase nem da Anthropic). Se ficar fora do ar, a
// importação automática falha mas o cadastro manual de feriados continua
// funcionando normalmente.
export async function fetchNationalHolidays(year) {
  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
  if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
  const data = await res.json();
  return data.map((h) => ({ date: h.date, name: h.name, scope: 'nacional' }));
}
