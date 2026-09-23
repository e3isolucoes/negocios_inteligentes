// Configuração pública mínima mantida no repositório para que o módulo exista
// mesmo quando o deploy principal (AWS/Cognito) não usa o Supabase.
// O workflow de publicação substitui este arquivo quando o fallback legado é
// habilitado com uma chave pública válida.
export const SUPABASE_URL = 'https://fsyginnpvonruifetjjs.supabase.co';
export const SUPABASE_ANON_KEY = '';
