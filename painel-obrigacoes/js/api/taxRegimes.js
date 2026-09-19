import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchTaxRegimes() {
  if (isAwsDataBackend()) return (await awsData.list('tax_regimes')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const { data, error } = await supabase.from('tax_regimes').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createTaxRegime(regime) {
  if (isAwsDataBackend()) return awsData.create('tax_regimes', regime);
  const { data, error } = await supabase.from('tax_regimes').insert(withCurrentWorkspace(regime)).select().single();
  if (error) throw error;
  return data;
}

export async function updateTaxRegime(id, patch) {
  if (isAwsDataBackend()) return awsData.update('tax_regimes', id, patch);
  const { data, error } = await supabase.from('tax_regimes').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTaxRegime(id) {
  if (isAwsDataBackend()) return awsData.remove('tax_regimes', id);
  const { error } = await supabase.from('tax_regimes').delete().eq('id', id);
  if (error) throw error;
}

// Vínculos regime <-> regra do catálogo (tabela M:N tax_regime_rules).
export async function fetchTaxRegimeRules() {
  if (isAwsDataBackend()) return awsData.list('tax_regime_rules');
  const { data, error } = await supabase.from('tax_regime_rules').select('*');
  if (error) throw error;
  return data;
}

export async function linkRuleToRegime(taxRegimeId, obligationRuleId) {
  if (isAwsDataBackend()) {
    await awsData.create('tax_regime_rules', { tax_regime_id: taxRegimeId, obligation_rule_id: obligationRuleId });
    return;
  }
  const { error } = await supabase
    .from('tax_regime_rules')
    .insert(withCurrentWorkspace({ tax_regime_id: taxRegimeId, obligation_rule_id: obligationRuleId }));
  if (error) throw error;
}

export async function unlinkRuleFromRegime(taxRegimeId, obligationRuleId) {
  if (isAwsDataBackend()) {
    const link = (await awsData.list('tax_regime_rules')).find((item) => item.tax_regime_id === taxRegimeId && item.obligation_rule_id === obligationRuleId);
    if (link) await awsData.remove('tax_regime_rules', link.id);
    return;
  }
  const { error } = await supabase
    .from('tax_regime_rules')
    .delete()
    .eq('tax_regime_id', taxRegimeId)
    .eq('obligation_rule_id', obligationRuleId);
  if (error) throw error;
}
