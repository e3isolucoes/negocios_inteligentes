export const PORTAL_AUTH_REQUEST = 'E3I_TOOL_AUTH_REQUEST';
export const PORTAL_AUTH_SESSION = 'E3I_TOOL_AUTH_SESSION';
export const DEFAULT_PORTAL_ORIGIN = 'https://portal.e3isolucoes.com.br';

export function readPortalSession(event, parentWindow, portalOrigin = DEFAULT_PORTAL_ORIGIN) {
  if (event.origin !== portalOrigin || event.source !== parentWindow) return null;
  if (event.data?.type !== PORTAL_AUTH_SESSION) return null;

  const session = event.data.session || event.data;
  // O Portal autentica o usuário em um domínio separado e, como já ocorre nas
  // demais ferramentas, pode entregar somente o token temporário específico da
  // ferramenta. Não exija a senha nem o refresh token do Painel para o handoff.
  const accessToken = session.access_token || session.id_token || session.IdToken;
  const refreshToken = session.refresh_token || session.RefreshToken;
  const cognitoAccessToken = session.cognito_access_token || session.AccessToken;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  return {
    access_token: accessToken,
    ...(typeof refreshToken === 'string' && refreshToken ? { refresh_token: refreshToken } : {}),
    ...(typeof cognitoAccessToken === 'string' && cognitoAccessToken
      ? { cognito_access_token: cognitoAccessToken }
      : {}),
  };
}

// Quando a ferramenta está embutida no Portal E3I, pede ao frame pai a sessão
// já autenticada. A origem e a janela remetente são verificadas antes que os
// tokens sejam entregues ao Supabase, evitando aceitar credenciais de outros
// sites. O listener permanece ativo para receber uma sessão renovada.
export function bootstrapPortalSession({
  windowObject = window,
  portalOrigin = globalThis.E3I_CONFIG?.portalOrigin || DEFAULT_PORTAL_ORIGIN,
  restoreSession,
  timeoutMs = 1500,
} = {}) {
  if (windowObject.parent === windowObject) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    windowObject.addEventListener('message', async (event) => {
      const session = readPortalSession(event, windowObject.parent, portalOrigin);
      if (!session) return;
      try {
        const result = await restoreSession(session);
        finish(result?.data?.session || session);
      } catch (error) {
        console.error('Não foi possível restaurar a sessão do Portal E3I', error);
        finish(null);
      }
    });

    windowObject.parent.postMessage({ type: PORTAL_AUTH_REQUEST }, portalOrigin);
    windowObject.setTimeout(() => finish(null), timeoutMs);
  });
}
