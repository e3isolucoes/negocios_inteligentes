export function requireWorkspaceAvailable(workspace, today = new Date().toISOString().slice(0, 10)) {
  if (!workspace) throw Object.assign(new Error('Empresa não está disponível.'), { statusCode: 403 });
  if (workspace.access_status === 'suspended') throw Object.assign(new Error('O acesso desta empresa está suspenso.'), { statusCode: 403 });
  if (workspace.access_status === 'trial' && workspace.trial_ends_at && workspace.trial_ends_at < today) {
    throw Object.assign(new Error('O período de avaliação desta empresa terminou.'), { statusCode: 403 });
  }
}
