import { STATE } from '../state.js';

// Todo registro operacional nasce no espaço da pessoa autenticada. Manter
// isso em um único ponto evita que um novo formulário seja criado sem o
// vínculo empresarial. O trigger do banco repete a validação como barreira
// de segurança e rejeita qualquer workspace diferente.
export function withCurrentWorkspace(values) {
  const workspaceId = STATE.profile?.workspace_id;
  if (!workspaceId) throw new Error('Sua conta não está vinculada a um espaço de empresa.');
  return { ...values, workspace_id: workspaceId };
}

export function withCurrentWorkspaceMany(items) {
  return items.map(withCurrentWorkspace);
}
