import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { awsRequest, isAwsDataBackend } from './awsDataClient.js';

export const isAwsAdminBackend = () => isAwsDataBackend() || globalThis.E3I_CONFIG?.authBackend === 'cognito';

// Cria a conta de autenticação para um usuário novo, a partir da tela de
// Gerenciar → Equipe. Usa uma instância TEMPORÁRIA e independente do
// cliente Supabase (persistSession/autoRefreshToken desligados) — o
// `auth.signUp()` normal trocaria a sessão ativa do cliente que o chama
// pela do usuário recém-criado, o que derrubaria a sessão de quem está
// logado (o admin) só por cadastrar outra pessoa. Não temos (nem devemos
// ter, num app 100% client-side) a service role key para usar a API
// administrativa do Supabase — signUp() é a única forma segura de criar
// uma conta a partir do navegador com a chave anônima.
//
// O perfil (`profiles`) é criado automaticamente por um gatilho no banco
// (handle_new_user, ver sql/schema.sql) assim que a conta é criada — por
// isso não precisamos inserir nada na tabela profiles aqui, só atualizar
// nome/papel depois (ver doCreateUser em js/data.js).
//
// Atenção: se o projeto Supabase tiver "Confirm email" habilitado
// (padrão), a pessoa só consegue entrar depois de confirmar o e-mail (ou
// um admin confirmar manualmente em Authentication → Users no painel do
// Supabase). Isso é uma configuração do projeto, não algo que dá para
// contornar a partir do cliente.
export async function createUserAccount({ email, password, displayName, workspaceId, role }) {
  if (isAwsAdminBackend()) {
    return awsRequest('admin/users', { method: 'POST', body: { email, displayName, workspaceId, role } });
  }
  const tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await tempClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data; // { user, session } — session vem null se a confirmação de e-mail estiver habilitada
}

export function updateUserMembership(userId, workspaceId, patch) {
  return awsRequest(`admin/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(workspaceId)}`, { method: 'PATCH', body: patch });
}

export function removeUserMembership(userId, workspaceId) {
  return awsRequest(`admin/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
}
