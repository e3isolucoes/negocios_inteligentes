import { supabase } from '../supabaseClient.js';
import { withCurrentWorkspace } from './workspaceContext.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

export async function fetchCompletions() {
  if (isAwsDataBackend()) return awsData.list('completions');
  const { data, error } = await supabase.from('completions').select('*');
  if (error) throw error;
  return data;
}

// Grava a conclusão de UMA ocorrência específica. Como a tabela tem
// "unique (obligation_id, occurrence_date)", se duas pessoas clicarem
// "concluído" ao mesmo tempo para a mesma ocorrência, a segunda gravação
// falha com erro de duplicidade em vez de sobrescrever a primeira — isso
// nunca arrisca perder ou corromper a edição de outra pessoa.
export async function markCompletion({
  obligationId, occurrenceDate, userId, userLabel, attachmentPath, checklistTotal = null, checklistChecked = null,
  ocrStatus = null, ocrExtractedPeriod = null,
  movementStatus = 'nao_informado',
}) {
  if (isAwsDataBackend()) return awsData.create('completions', {
    obligation_id: obligationId,
    occurrence_date: occurrenceDate,
    done_by: userId,
    done_by_name: userLabel,
    attachment_path: attachmentPath,
    checklist_total: checklistTotal,
    checklist_checked: checklistChecked,
    ocr_status: ocrStatus,
    ocr_extracted_period: ocrExtractedPeriod,
    movement_status: movementStatus,
  });
  const { data, error } = await supabase
    .from('completions')
    .insert(withCurrentWorkspace({
      obligation_id: obligationId,
      occurrence_date: occurrenceDate,
      done_by: userId,
      done_by_name: userLabel,
      attachment_path: attachmentPath,
      checklist_total: checklistTotal,
      checklist_checked: checklistChecked,
      ocr_status: ocrStatus,
      ocr_extracted_period: ocrExtractedPeriod,
      movement_status: movementStatus,
    }))
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCompletion(completionId) {
  if (isAwsDataBackend()) return awsData.remove('completions', completionId);
  const { error } = await supabase.from('completions').delete().eq('id', completionId);
  if (error) throw error;
}

export async function updateCompletionAttachment(completionId, attachmentPath) {
  if (isAwsDataBackend()) return awsData.update('completions', completionId, { attachment_path: attachmentPath });
  const { data, error } = await supabase
    .from('completions')
    .update({ attachment_path: attachmentPath })
    .eq('id', completionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
