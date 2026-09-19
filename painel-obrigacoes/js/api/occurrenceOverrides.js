import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchOccurrenceOverrides() {
  if (isAwsDataBackend()) return awsData.list('obligation_date_overrides');
  const { data, error } = await supabase.from('obligation_date_overrides').select('*');
  if (error) throw error;
  return data;
}

// Upsert por (obligation_id, original_date): se já existir um ajuste para
// essa ocorrência, atualiza; senão, cria. Evita a UI ter que saber de
// antemão se já existe um ajuste para decidir entre insert/update.
export async function setOccurrenceOverride({
  obligationId, originalDate, overrideDate, reason,
}) {
  if (isAwsDataBackend()) {
    const existing = (await awsData.list('obligation_date_overrides')).find((item) => item.obligation_id === obligationId && item.original_date === originalDate);
    const values = { obligation_id: obligationId, original_date: originalDate, override_date: overrideDate, reason };
    return existing ? awsData.update('obligation_date_overrides', existing.id, values) : awsData.create('obligation_date_overrides', values);
  }
  const { data, error } = await supabase
    .from('obligation_date_overrides')
    .upsert(
      withCurrentWorkspace({
        obligation_id: obligationId, original_date: originalDate, override_date: overrideDate, reason,
      }),
      { onConflict: 'obligation_id,original_date' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOccurrenceOverride(id) {
  if (isAwsDataBackend()) return awsData.remove('obligation_date_overrides', id);
  const { error } = await supabase.from('obligation_date_overrides').delete().eq('id', id);
  if (error) throw error;
}
