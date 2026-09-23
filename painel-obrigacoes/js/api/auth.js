import { supabase } from '../supabaseClient.js';
import { SUPABASE_URL } from '../config.js';

const config = () => globalThis.E3I_CONFIG || {};
const usesCognito = () => config().authBackend === 'cognito';
const listeners = new Set();
let recoveryEmail = '';
let memorySession = null;

function decodeJwt(token) {
  const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(body))));
}
function cognitoSession(tokens) {
  const idToken = tokens?.IdToken || tokens?.access_token;
  const apiToken = tokens?.AccessToken || tokens?.cognito_access_token;
  if (!idToken || !apiToken) return null;
  const claims = decodeJwt(idToken);
  return { access_token: idToken, cognito_access_token: apiToken, expires_at: claims.exp, user: { id: claims['custom:legacy_user_id'] || claims['cognito:username'] || claims.sub, email: claims.email } };
}
function portalCognitoSession(tokens) {
  const idToken = tokens?.access_token;
  if (!idToken) return null;
  const claims = decodeJwt(idToken);
  const expectedIssuer = `https://cognito-idp.${config().cognitoRegion}.amazonaws.com/${config().cognitoUserPoolId}`;
  if (claims.iss !== expectedIssuer || claims.aud !== config().cognitoClientId || claims.token_use !== 'id') return null;
  if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return {
    access_token: idToken,
    cognito_access_token: tokens.cognito_access_token || null,
    expires_at: claims.exp,
    user: {
      id: claims['custom:legacy_user_id'] || claims['cognito:username'] || claims.sub,
      email: claims.email,
    },
  };
}
function portalSupabaseSession(tokens) {
  const accessToken = tokens?.access_token;
  if (!accessToken) return null;
  const claims = decodeJwt(accessToken);
  const expectedIssuer = `${String(SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1`;
  const issuer = String(claims.iss || '').replace(/\/+$/, '');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!expectedIssuer || issuer !== expectedIssuer || !audience.includes('authenticated')) return null;
  if (!claims.sub || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) return null;
  return {
    access_token: accessToken,
    cognito_access_token: null,
    expires_at: claims.exp,
    auth_provider: 'supabase',
    user: { id: claims.sub, email: claims.email || '' },
  };
}
function saveSession(session) {
  memorySession = session ? { ...session } : null;
  if (memorySession) delete memorySession.refresh_token;
  for (const callback of listeners) callback(memorySession ? 'SIGNED_IN' : 'SIGNED_OUT', memorySession);
}
function sessionEndpoint(path = '') {
  return `${String(config().awsApiBase || '').replace(/\/$/, '')}/v1/session${path}`;
}
async function sessionCall(path, options = {}) {
  const response = await fetch(sessionEndpoint(path), { ...options, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Sessão inválida ou expirada.'), { status: response.status });
  return body;
}
async function cognitoCall(target, payload) {
  const response = await fetch(`https://cognito-idp.${config().cognitoRegion}.amazonaws.com/`, { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${target}` }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || 'Falha na autenticação.'), { code: body.__type?.split('#').pop(), status: response.status });
  return body;
}

export async function signIn(email, password) {
  if (!usesCognito()) {
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.data?.session) saveSession({ ...result.data.session, refresh_token: undefined });
    return result;
  }
  try {
    const result = await sessionCall('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const session = cognitoSession(result); saveSession(session);
    return { data: { session }, error: null };
  } catch (error) { return { data: null, error }; }
}
export function getSignInErrorMessage(error) {
  if (['UserNotConfirmedException', 'email_not_confirmed'].includes(error?.code)) return 'Seu e-mail ainda não foi confirmado.';
  if (['NotAuthorizedException', 'UserNotFoundException'].includes(error?.code)) return 'E-mail ou senha inválidos.';
  if (error?.code === 'invalid_credentials') return 'E-mail ou senha inválidos. Confirme também se a conta pertence ao mesmo projeto Supabase configurado neste painel.';
  if (['TooManyRequestsException', 'over_request_rate_limit'].includes(error?.code) || error?.status === 429) return 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível entrar agora. Verifique sua conexão e tente novamente.';
}
export async function signOut() {
  if (usesCognito()) await sessionCall('', { method: 'DELETE' }).catch(() => {});
  else if (supabase?.auth) await supabase.auth.signOut().catch(() => {});
  saveSession(null);
}
export async function getSession() {
  let session = readStoredSession();
  if (session?.expires_at > Math.floor(Date.now() / 1000) + 30) return { data: { session } };
  if (!usesCognito()) return { data: { session } };
  try {
    session = cognitoSession(await sessionCall('/refresh', { method: 'POST' }));
    saveSession(session);
  } catch { saveSession(null); session = null; }
  return { data: { session } };
}
export function setSession(tokens) {
  if (!usesCognito()) return supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
  let session = null;
  try { session = portalCognitoSession(tokens); } catch { session = null; }
  if (!session) {
    try { session = portalSupabaseSession(tokens); } catch { session = null; }
  }
  if (!session) return Promise.resolve({ data: { session: null }, error: new Error('Sessão do portal inválida ou expirada.') });
  saveSession(session);
  return Promise.resolve({ data: { session }, error: null });
}

function readStoredSession() { return memorySession; }

export async function readPortalSsoResponse(response) {
  const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
  let body = {};
  if (contentType.includes('application/json')) {
    body = (await response.json().catch(() => ({}))) || {};
  }
  if (response.ok) return body;
  const unavailable = [502, 503, 504].includes(response.status);
  const message = unavailable
    ? 'O serviço do Painel está temporariamente indisponível. Tente novamente em alguns instantes.'
    : body.error || 'Código de acesso inválido ou expirado.';
  throw Object.assign(new Error(message), {
    status: response.status,
    requestId: body.requestId || response.headers?.get?.('x-request-id') || null,
  });
}

export async function completePortalSso(location = window.location) {
  const params = new URLSearchParams(location.search || '');
  const fragment = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  // O Portal abre todas as ferramentas com o ticket na query string. As
  // primeiras versões do Painel esperavam o código somente no fragmento e,
  // por isso, exibiam novamente a tela de acesso apesar do usuário já estar
  // autenticado. Mantemos o fragmento como compatibilidade com atalhos antigos.
  const launchCode = params.get('portal_sso_code') || fragment.get('portal_sso_code');
  const tokenHash = params.get('portal_sso_token');
  if (!launchCode && !tokenHash) return null;
  const tokenType = params.get('portal_sso_type');
  params.delete('portal_sso_code'); params.delete('portal_sso_token'); params.delete('portal_sso_type');
  fragment.delete('portal_sso_code');
  const query = params.toString();
  const remainingFragment = fragment.toString();
  const cleanUrl = `${location.pathname}${query ? `?${query}` : ''}${remainingFragment ? `#${remainingFragment}` : ''}`;
  window.history.replaceState({}, document.title, cleanUrl);

  if (launchCode) {
    if (!usesCognito() || !config().awsApiBase) throw new Error('Acesso AWS não configurado.');
    const response = await fetch(`${config().awsApiBase.replace(/\/$/, '')}/v1/portal-session/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: launchCode }),
      credentials: 'include', cache: 'no-store',
    });
    const tokens = await readPortalSsoResponse(response);
    const restored = await setSession(tokens);
    if (restored.error || !restored.data.session) throw restored.error || new Error('Sessão AWS não foi criada.');
    return restored.data.session;
  }

  if (tokenType !== 'magiclink') throw new Error('Tipo de acesso único inválido.');
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data.session) throw error || new Error('Sessão do portal não foi criada.');

  const session = { ...data.session, auth_provider: 'supabase' };
  saveSession(session);
  return session;
}
export function onAuthStateChange(callback) {
  if (!usesCognito()) return supabase.auth.onAuthStateChange(callback);
  listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
}
export async function fetchMyProfile(userId) {
  if (usesCognito()) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle(); if (error) throw error; return data;
}
export async function sendPasswordResetEmail(email) {
  if (!usesCognito()) { const { error } = await supabase.auth.resetPasswordForEmail(email); if (error) throw error; return; }
  recoveryEmail = email; await cognitoCall('ForgotPassword', { ClientId: config().cognitoClientId, Username: email });
}
export function isPasswordRecoveryUrl(location = window.location) {
  if (usesCognito()) return false;
  const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, '')); const queryParams = new URLSearchParams(location.search || '');
  return hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
}
export async function updateOwnPassword(password, code) {
  if (!usesCognito()) { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; return; }
  if (!recoveryEmail) throw new Error('Solicite um novo código de recuperação.');
  await cognitoCall('ConfirmForgotPassword', { ClientId: config().cognitoClientId, Username: recoveryEmail, ConfirmationCode: code, Password: password });
}
export async function getAccessToken() { return (await getSession()).data.session?.access_token || null; }
