import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchCompanies() {
  if (isAwsDataBackend()) return (await awsData.list('companies')).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const { data, error } = await supabase.from('companies').select('*').order('name');
  if (error) throw error;
  return data;
}

// Usado quando a pessoa digita o nome de uma empresa nova no formulário de
// obrigação. Qualquer integrante pode criar no próprio workspace; alterações
// posteriores na empresa continuam reservadas à administração.
export async function ensureCompany(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (isAwsDataBackend()) {
    const existing = (await awsData.list('companies')).find((company) => (company.name || '').localeCompare(trimmed, 'pt-BR', { sensitivity: 'base' }) === 0);
    return existing || awsData.create('companies', { name: trimmed });
  }
  const { data: existing } = await supabase.from('companies').select('*').eq('name', trimmed).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from('companies').insert(withCurrentWorkspace({ name: trimmed })).select().single();
  if (error) throw error;
  return data;
}

export async function createCompany(name) {
  if (isAwsDataBackend()) return awsData.create('companies', { name: name.trim() });
  const { data, error } = await supabase.from('companies').insert(withCurrentWorkspace({ name: name.trim() })).select().single();
  if (error) throw error;
  return data;
}

export async function updateCompany(id, name) {
  if (isAwsDataBackend()) return awsData.update('companies', id, { name: name.trim() });
  const { data, error } = await supabase.from('companies').update({ name: name.trim() }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// `regimeId` pode ser null (empresa sem regime tributário definido).
export async function updateCompanyRegime(id, regimeId) {
  if (isAwsDataBackend()) return awsData.update('companies', id, { tax_regime_id: regimeId });
  const { data, error } = await supabase
    .from('companies')
    .update({ tax_regime_id: regimeId })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Empresas usadas em alguma obrigação: o vínculo (company_id) simplesmente
// vira nulo nessas obrigações (on delete set null, definido no schema) — a
// obrigação continua existindo, só sem empresa associada.
export async function deleteCompany(id) {
  if (isAwsDataBackend()) return awsData.remove('companies', id);
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) throw error;
}
