import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Checagem segura de configuração (evita erro se SUPABASE_URL for undefined)
const isConfigured = typeof SUPABASE_URL === 'string'
  && SUPABASE_URL.length > 0
  && !SUPABASE_URL.includes('COLE_AQUI');

// Tenta criar o cliente apenas se tudo estiver ok e a lib estiver carregada
export const supabase = (isConfigured
  && typeof window !== 'undefined'
  && window.supabase
  && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export function isSupabaseConfigured() {
  return isConfigured;
}
