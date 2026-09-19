// js/api/validation.js
// ---------------------------------------------------------------------------
// Etapa de validação: fila do validador, aprovação, rejeição e reenvio.
// As regras vivem no banco; aqui só traduzimos as mensagens.
// ---------------------------------------------------------------------------
import { supabase } from './supabaseClient.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';
import { STATE } from '../state.js';

function translate(msg = '') {
  if (msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'Você não tem permissão para esta ação.';
  }
  return msg;
}

// Sob RLS, uma escrita barrada volta como zero linhas SEM erro.
function requireRow(data, error, denied) {
  if (error) throw new Error(translate(error.message));
  if (!data || (Array.isArray(data) && data.length === 0)) throw new Error(denied);
  return Array.isArray(data) ? data[0] : data;
}

/** Fila do validador logado (o admin vê tudo). */
export async function fetchPendingValidations() {
  if (isAwsDataBackend()) return (await awsData.list('completions'))
    .filter((item) => item.status === 'aguardando_validacao')
    .sort((a, b) => (a.submitted_at || a.created_at || '').localeCompare(b.submitted_at || b.created_at || ''));
  const { data, error } = await supabase
    .from('vw_aguardando_validacao')
    .select('*')
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(translate(error.message));
  return data || [];
}

/**
 * Só a contagem, para o selo da aba. Usa head + count exato: não traz linha
 * nenhuma, então pode ser chamada com frequência sem pesar.
 */
export async function countPendingValidations() {
  if (isAwsDataBackend()) return (await awsData.list('completions')).filter((item) => item.status === 'aguardando_validacao').length;
  const { count, error } = await supabase
    .from('vw_aguardando_validacao')
    .select('completion_id', { count: 'exact', head: true });
  if (error) return 0;          // selo é acessório: nunca derruba a tela
  return count || 0;
}

/** Quantas voltaram rejeitadas para o usuário logado corrigir. */
export async function countRejected() {
  if (isAwsDataBackend()) return (await awsData.list('completions')).filter((item) => item.status === 'rejeitada' && item.done_by === STATE.session?.id).length;
  const { count, error } = await supabase
    .from('vw_rejeitadas')
    .select('completion_id', { count: 'exact', head: true });
  if (error) return 0;
  return count || 0;
}

/** O que voltou rejeitado para o usuário logado corrigir. */
export async function fetchRejected() {
  if (isAwsDataBackend()) return (await awsData.list('completions'))
    .filter((item) => item.status === 'rejeitada' && item.done_by === STATE.session?.id)
    .sort((a, b) => (b.rejected_at || b.updated_at || '').localeCompare(a.rejected_at || a.updated_at || ''));
  const { data, error } = await supabase
    .from('vw_rejeitadas')
    .select('*')
    .order('rejeitado_em', { ascending: false });
  if (error) throw new Error(translate(error.message));
  return data || [];
}

/**
 * O que EU enviei e ainda espera validação. É o outro lado da fila: sem isso,
 * quem executou não sabe se a tarefa travou com o validador.
 */
export async function fetchMySubmissions() {
  if (isAwsDataBackend()) return (await awsData.list('completions'))
    .filter((item) => item.status === 'aguardando_validacao' && item.done_by === STATE.session?.id)
    .sort((a, b) => (a.submitted_at || a.created_at || '').localeCompare(b.submitted_at || b.created_at || ''));
  const { data, error } = await supabase
    .from('vw_meus_envios_pendentes')
    .select('*')
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(translate(error.message));
  return data || [];
}

export async function approve(completionId) {
  if (isAwsDataBackend()) return awsData.update('completions', completionId, { status: 'validada', validated_at: new Date().toISOString(), validator_id: STATE.session?.id });
  const { data, error } = await supabase.from('completions')
    .update({ status: 'validada' })
    .eq('id', completionId)
    .select();
  return requireRow(data, error,
    'Somente o validador designado desta obrigação pode aprovar.');
}

export async function reject(completionId, reason) {
  const motivo = (reason || '').trim();
  if (motivo.length < 10) {
    throw new Error('Descreva o que precisa ser corrigido (mínimo 10 caracteres).');
  }
  if (isAwsDataBackend()) return awsData.update('completions', completionId, { status: 'rejeitada', rejection_reason: motivo, rejected_at: new Date().toISOString(), validator_id: STATE.session?.id });
  const { data, error } = await supabase.from('completions')
    .update({ status: 'rejeitada', rejection_reason: motivo })
    .eq('id', completionId)
    .select();
  return requireRow(data, error,
    'Somente o validador designado desta obrigação pode rejeitar.');
}

/** Reenvio após corrigir. Só quem executou a tarefa. */
export async function resubmit(completionId) {
  if (isAwsDataBackend()) return awsData.update('completions', completionId, { status: 'aguardando_validacao', rejection_reason: null, submitted_at: new Date().toISOString() });
  const { data, error } = await supabase.from('completions')
    .update({ status: 'aguardando_validacao' })
    .eq('id', completionId)
    .select();
  return requireRow(data, error,
    'Somente quem executou a tarefa pode reenviá-la para validação.');
}

// --- Configuração (Gestão) --------------------------------------------------

/** Define validação e validador para uma categoria inteira. */
export async function setCategoryValidator(categoryId, validatorId, {
  require = true, applyToExisting = false,
} = {}) {
  if (isAwsDataBackend()) throw new Error('Configuração em lote de validadores ainda não está habilitada no backend AWS.');
  const { data, error } = await supabase.rpc('definir_validador_categoria', {
    p_categoria_id: categoryId,
    p_validador_id: validatorId,
    p_exigir: require,
    p_aplicar_existentes: applyToExisting,
  });
  if (error) throw new Error(translate(error.message));
  return data;
}

/** Define validação e validador numa obrigação específica. */
export async function setObligationValidator(obligationId, validatorId, require = true) {
  if (isAwsDataBackend()) return awsData.update('obligations', obligationId, { requires_validation: require, validator_id: validatorId });
  const { data, error } = await supabase.from('obligations')
    .update({ requires_validation: require, validator_id: validatorId })
    .eq('id', obligationId)
    .select();
  return requireRow(data, error, 'Somente a Gestão pode definir validadores.');
}

/** Obrigações que exigem validação e estão sem validador — a Gestão precisa ver. */
export async function fetchMissingValidators() {
  if (isAwsDataBackend()) return (await awsData.list('obligations')).filter((item) => item.requires_validation && !item.validator_id);
  const { data, error } = await supabase.from('vw_sem_validador').select('*');
  if (error) throw new Error(translate(error.message));
  return data || [];
}

/** Painel da Gestão: fila e tempo médio por validador. */
export async function fetchValidationPerformance() {
  const { data, error } = await supabase.from('vw_validacao_desempenho').select('*');
  if (error) throw new Error(translate(error.message));
  return data || [];
}

/** Rótulo e cor do estado, para os cartões. */
export function statusInfo(status) {
  switch (status) {
    case 'aguardando_validacao':
      return { label: 'Aguardando validação', color: '#ca8a04', icon: '⏳' };
    case 'rejeitada':
      return { label: 'Devolvida para correção', color: '#dc2626', icon: '↩' };
    case 'validada':
      return { label: 'Concluída', color: '#16a34a', icon: '✓' };
    default:
      return { label: 'Pendente', color: '#64748b', icon: '' };
  }
}
