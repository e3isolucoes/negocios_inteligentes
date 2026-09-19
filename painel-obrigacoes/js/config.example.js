// =============================================================================
// Exemplo de js/config.js — copie este arquivo para js/config.js e preencha as
// credenciais do seu projeto Supabase (Project Settings → API).
// Não comite o arquivo js/config.js com credenciais reais.
// =============================================================================
export const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_...';

// O Supabase continua responsável pela identidade. Os dados operacionais
// podem ser alternados separadamente, permitindo rollback sem novo login.
globalThis.E3I_CONFIG = Object.freeze({
  dataBackend: 'supabase', // altere para 'aws' somente em homologação validada
  awsApiBase: 'https://SEU_API_ID.execute-api.sa-east-1.amazonaws.com',
});
