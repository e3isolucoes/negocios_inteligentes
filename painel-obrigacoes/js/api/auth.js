import { supabase } from '../supabaseClient.js';
import { SUPABASE_URL } from '../config.js';

const config = () => globalThis.E3I_CONFIG || {};
const usesCognito = () => config().authBackend === 'cognito';
const listeners = new Set();
let recoveryEmail = '';
let memorySession = null;
let browserRefreshPromise = null;

function apiBase() {
  return String(config().awsApiBase || '').replace(/\/$/, '');
}

async function browserSessionCall(path, { method = 'POST', body } = {}) {
  const base = apiBase();
  if (!base) throw Object.assign(new Error('Serviço de sessão AWS não configurado.'), { code: 'session_service_unavailable' });
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 204) return { response, payload: null };
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error || 'Não foi possível renovar sua sessão.'),
      { status: response.status, code: response.status === 401 ? 'session_expired' : 'session_refresh_failed' },
    );
  }
  return { response, payload };
}

async function refreshBrowserSession() {
  if (!usesCognito() || !apiBase()) return null;
  if (!browserRefreshPromise) {
    browserRefreshPromise = (async () => {
      const { payload } = await browserSessionCall('session/refresh');
      if (!payload) return null;
      const session = portalCognitoSession(payload);
      if (!session) throw Object.assign(new Error('Sessão renovada inválida.'), { code: 'session_refresh_invalid' });
      saveSession(session);
      return session;
    })().finally(() => { browserRefreshPromise = null; });
  }
  return browserRefreshPromise;
}

function decodeJwt(token) {
  const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(body))));
}
function cognitoSession(tokens) {
  if (!tokens?.IdToken || !tokens?.AccessToken) return null;
  const claims = decodeJwt(tokens.IdToken);
  return { access_token: tokens.IdToken, cognito_access_token: tokens.AccessToken, refresh_token: tokens.RefreshToken, expires_at: claims.exp, user: { id: claims['custom:legacy_user_id'] || claims['cognito:username'] || claims.sub, email: claims.email } };
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
async function cognitoCall(target, payload) {
  const response = await fetch(`https://cognito-idp.${config().cognitoRegion}.amazonaws.com/`, { method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${target}` }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || 'Falha na autenticação.'), { code: body.__type?.split('#').pop(), status: response.status });
  return body;
}

export async function signIn(email, password) {
  if (!usesCognito()) return supabase.auth.signInWithPassword({ email, password });
  try {
    if (apiBase()) {
      const { payload } = await browserSessionCall('session/login', {
        body: { email: String(email || '').trim().toLowerCase(), password: String(password || '') },
      });
      const session = portalCognitoSession(payload);
      if (!session) throw Object.assign(new Error('Sessão AWS inválida.'), { code: 'session_invalid' });
      saveSession(session);
      return { data: { session }, error: null };
    }
    const result = await cognitoCall('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: config().cognitoClientId, AuthParameters: { USERNAME: email, PASSWORD: password } });
    const session = cognitoSession(result.AuthenticationResult); saveSession(session);
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
  const stored = readStoredSession();
  if (!usesCognito()) return supabase.auth.signOut();
  if (stored?.auth_provider === 'supabase') {
    saveSession(null);
    if (supabase?.auth) await supabase.auth.signOut().catch(() => {});
    return;
  }
  try {
    if (apiBase()) await browserSessionCall('session', { method: 'DELETE' });
  } catch {
    const session = stored;
    if (session?.cognito_access_token) await cognitoCall('GlobalSignOut', { AccessToken: session.cognito_access_token }).catch(() => {});
  } finally {
    saveSession(null);
  }
}
export async function getSession() {
  if (!usesCognito()) return supabase.auth.getSession();
  let session = readStoredSession();
  if (session?.auth_provider === 'supabase') {
    if (session.expires_at > Math.floor(Date.now() / 1000)) return { data: { session } };
    if (!session.refresh_token || !supabase?.auth) {
      saveSession(null);
      return { data: { session: null } };
    }
    try {
      const result = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      if (result.error || !result.data.session) throw result.error || new Error('Sessão expirada.');
      session = { ...result.data.session, auth_provider: 'supabase' };
      saveSession(session);
      return { data: { session } };
    } catch {
      saveSession(null);
      return { data: { session: null } };
    }
  }
  const now = Math.floor(Date.now() / 1000);
  if (session?.expires_at > now + 30) return { data: { session } };

  if (apiBase()) {
    try {
      const refreshed = await refreshBrowserSession();
      if (refreshed) return { data: { session: refreshed } };
    } catch (error) {
      if (error?.status !== 401 && session?.expires_at > now) return { data: { session } };
    }
  }

  // Compatibilidade temporária com sessões antigas que ainda guardavam o refresh token no navegador.
  if (session?.refresh_token) {
    try {
      const result = await cognitoCall('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: config().cognitoClientId, AuthParameters: { REFRESH_TOKEN: session.refresh_token } });
      session = cognitoSession({ ...result.AuthenticationResult, RefreshToken: session.refresh_token });
      saveSession(session);
      return { data: { session } };
    } catch {}
  }

  saveSession(null);
  return { data: { session: null } };
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
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
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
export async function refreshAccessToken() {
  if (!usesCognito()) return (await getSession()).data.session?.access_token || null;
  try {
    const refreshed = await refreshBrowserSession();
    if (refreshed?.access_token) return refreshed.access_token;
  } catch (error) {
    if (error?.status === 401) saveSession(null);
    throw error;
  }
  return null;
}

export async function getAccessToken() { return (await getSession()).data.session?.access_token || null; }
