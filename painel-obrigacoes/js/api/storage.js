import { supabase } from '../supabaseClient.js';
import { STATE } from '../state.js';
import { awsData, isAwsDataBackend } from './awsDataClient.js';

// Caminho dentro do bucket: workspaceId/obligationId/occurrenceDate-timestamp-nome —
// gerado ANTES de existir uma linha de conclusão, porque agora o
// comprovante é obrigatório e precisa ser enviado antes da conclusão ser
// gravada (não depois, como numa versão anterior).
export async function uploadAttachment(file, obligationId, occurrenceDate) {
  if (isAwsDataBackend()) {
    const signed = await awsData.uploadUrl({
      obligationId, occurrenceDate, fileName: file.name, contentType: file.type, size: file.size,
    });
    const response = await fetch(signed.url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!response.ok) throw new Error('Não foi possível enviar o comprovante para o armazenamento seguro.');
    return signed.path;
  }
  const workspaceId = STATE.profile?.workspace_id;
  if (!workspaceId) throw new Error('Sua conta não está vinculada a um espaço de empresa.');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${workspaceId}/${obligationId}/${occurrenceDate}-${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('comprovantes').upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

// O bucket é privado, então a visualização exige um link assinado
// (expira em 1 hora — suficiente para abrir/baixar o arquivo na hora).
export async function getAttachmentUrl(path) {
  if (isAwsDataBackend()) return (await awsData.downloadUrl(path)).url;
  const { data, error } = await supabase.storage.from('comprovantes').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
