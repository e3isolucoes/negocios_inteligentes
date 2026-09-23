(() => {
  const nativeFetch = window.fetch.bind(window);
  let currentEmail = '';
  let modal = null;
  let returnFocus = null;
  let completingPasswordChange = false;

  function getRequestUrl(request) {
    if (typeof request === 'string') return request;
    if (request instanceof URL) return request.href;
    return request?.url || '';
  }

  function getLoginFields(form) {
    const passwordInput = form.querySelector('input[type="password"]');
    if (!passwordInput) return null;
    const identityInput = form.querySelector('input[type="email"], input[name*="email" i], input[autocomplete="username"], input[type="text"]');
    if (!identityInput) return null;
    return { identityInput, passwordInput };
  }

  async function requestFirstLogin(email, button) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) return false;
    if (button) button.disabled = true;
    try {
      await nativeFetch('/api/auth/first-login/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      openFirstLogin(normalizedEmail);
      const errorBox = modal?.querySelector('[data-e3i-error]');
      if (errorBox) errorBox.textContent = 'Código solicitado. Verifique o e-mail informado.';
      return true;
    } catch {
      window.alert('Não foi possível iniciar o primeiro acesso agora. Tente novamente.');
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function enhanceLoginForm(form) {
    const fields = getLoginFields(form);
    if (!fields) return;
    const { identityInput, passwordInput } = fields;

    if (!identityInput.hasAttribute('autocomplete')) identityInput.setAttribute('autocomplete', 'username');
    if (!passwordInput.hasAttribute('autocomplete')) passwordInput.setAttribute('autocomplete', 'current-password');

    if (!form.querySelector('[data-e3i-first-login-start]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'e3i-first-login-start';
      button.dataset.e3iFirstLoginStart = 'true';
      button.textContent = 'Primeiro acesso / definir nova senha';
      button.addEventListener('click', async () => {
        const email = String(identityInput.value || '').trim();
        if (!email || !email.includes('@')) {
          identityInput.focus();
          window.alert('Informe primeiro o e-mail da conta.');
          return;
        }
        await requestFirstLogin(email, button);
      });
      form.appendChild(button);
    }
  }

  function enhanceLoginForms() {
    document.querySelectorAll('form').forEach(enhanceLoginForm);
  }

  function watchLoginForm() {
    const apply = () => enhanceLoginForms();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function clearFirstLoginFields(wrapper = modal) {
    if (!wrapper) return;
    const code = wrapper.querySelector('[data-e3i-code]');
    const password = wrapper.querySelector('[data-e3i-password]');
    const confirm = wrapper.querySelector('[data-e3i-confirm]');
    const error = wrapper.querySelector('[data-e3i-error]');
    if (code) code.value = '';
    if (password) password.value = '';
    if (confirm) confirm.value = '';
    if (error) error.textContent = '';
  }

  function closeFirstLogin({ restoreFocus = true } = {}) {
    if (!modal || completingPasswordChange) return false;
    clearFirstLoginFields(modal);
    modal.hidden = true;
    currentEmail = '';
    const target = returnFocus;
    returnFocus = null;
    if (restoreFocus && target?.isConnected && typeof target.focus === 'function') {
      setTimeout(() => target.focus(), 0);
    }
    return true;
  }

  function ensureModal() {
    if (modal) return modal;
    const wrapper = document.createElement('div');
    wrapper.id = 'e3i-first-login-modal';
    wrapper.className = 'e3i-first-login-backdrop';
    wrapper.hidden = true;
    wrapper.innerHTML = `
      <section class="e3i-first-login-card" role="dialog" aria-modal="true" aria-labelledby="e3i-first-login-title">
        <div class="e3i-first-login-brand">E3I SOLUÇÕES</div>
        <h2 id="e3i-first-login-title">Defina uma nova senha</h2>
        <p class="e3i-first-login-intro">Por segurança, contas migradas precisam criar uma nova senha no primeiro acesso. Um código foi enviado para <strong data-e3i-first-login-email></strong>.</p>
        <form data-e3i-first-login-form>
          <label>
            Código recebido por e-mail
            <input data-e3i-code type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required>
          </label>
          <label>
            Nova senha
            <input data-e3i-password type="password" autocomplete="new-password" minlength="12" maxlength="128" required>
          </label>
          <label>
            Confirme a nova senha
            <input data-e3i-confirm type="password" autocomplete="new-password" minlength="12" maxlength="128" required>
          </label>
          <div class="e3i-password-policy" aria-live="polite">
            Use 12 ou mais caracteres, com maiúscula, minúscula, número e símbolo. Não use o nome do e-mail.
          </div>
          <div class="e3i-first-login-error" data-e3i-error role="alert"></div>
          <div class="e3i-first-login-actions">
            <button type="button" class="e3i-link-button" data-e3i-resend>Reenviar código</button>
            <div class="e3i-first-login-primary-actions">
              <button type="button" class="e3i-secondary-button" data-e3i-cancel>Cancelar</button>
              <button type="submit" class="e3i-primary-button">Salvar nova senha</button>
            </div>
          </div>
        </form>
      </section>`;
    document.body.appendChild(wrapper);
    modal = wrapper;

    const form = wrapper.querySelector('[data-e3i-first-login-form]');
    const resend = wrapper.querySelector('[data-e3i-resend]');
    const cancel = wrapper.querySelector('[data-e3i-cancel]');
    const errorBox = wrapper.querySelector('[data-e3i-error]');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      const code = wrapper.querySelector('[data-e3i-code]').value.trim();
      const newPassword = wrapper.querySelector('[data-e3i-password]').value;
      const confirmPassword = wrapper.querySelector('[data-e3i-confirm]').value;
      if (newPassword !== confirmPassword) {
        errorBox.textContent = 'As duas senhas precisam ser iguais.';
        return;
      }

      const submit = form.querySelector('button[type="submit"]');
      completingPasswordChange = true;
      submit.disabled = true;
      cancel.disabled = true;
      try {
        const response = await nativeFetch('/api/auth/first-login/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail, code, newPassword }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          errorBox.textContent = payload.error || 'Não foi possível alterar a senha.';
          return;
        }
        completingPasswordChange = false;
        closeFirstLogin({ restoreFocus: false });
        window.alert('Senha atualizada com sucesso. Entre novamente usando a nova senha.');
        const passwordInput = document.querySelector('input[type="password"]');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.focus();
        }
      } catch {
        errorBox.textContent = 'Falha de comunicação. Tente novamente.';
      } finally {
        completingPasswordChange = false;
        submit.disabled = false;
        cancel.disabled = false;
      }
    });

    cancel.addEventListener('click', () => closeFirstLogin());

    wrapper.addEventListener('click', (event) => {
      if (event.target === wrapper) closeFirstLogin();
    });

    wrapper.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeFirstLogin();
    });

    resend.addEventListener('click', async () => {
      errorBox.textContent = '';
      resend.disabled = true;
      try {
        await nativeFetch('/api/auth/first-login/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail }),
        });
        errorBox.textContent = 'Se permitido pelo limite de segurança, um novo código foi enviado.';
      } catch {
        errorBox.textContent = 'Não foi possível solicitar outro código agora.';
      } finally {
        setTimeout(() => { resend.disabled = false; }, 3000);
      }
    });

    return wrapper;
  }

  function openFirstLogin(email) {
    currentEmail = String(email || '').trim().toLowerCase();
    const wrapper = ensureModal();
    if (wrapper.hidden) returnFocus = document.activeElement;
    wrapper.querySelector('[data-e3i-first-login-email]').textContent = currentEmail;
    clearFirstLoginFields(wrapper);
    wrapper.hidden = false;
    setTimeout(() => wrapper.querySelector('[data-e3i-code]').focus(), 0);
  }

  function handleLoginPayload(status, payload) {
    if (status === 428 && payload?.code === 'PASSWORD_CHANGE_REQUIRED' && payload?.email) {
      queueMicrotask(() => openFirstLogin(payload.email));
    }
  }

  function patchXmlHttpRequest() {
    const Xhr = window.XMLHttpRequest;
    if (!Xhr || Xhr.prototype.__e3iFirstLoginPatched) return;
    const nativeOpen = Xhr.prototype.open;
    const nativeSend = Xhr.prototype.send;

    Xhr.prototype.open = function(method, url, ...rest) {
      this.__e3iRequestUrl = String(url || '');
      return nativeOpen.call(this, method, url, ...rest);
    };

    Xhr.prototype.send = function(...args) {
      if (String(this.__e3iRequestUrl || '').includes('/api/auth/login')) {
        this.addEventListener('load', () => {
          if (this.status !== 428) return;
          try {
            handleLoginPayload(this.status, JSON.parse(this.responseText || '{}'));
          } catch {
            // O login principal continua tratando a resposta normalmente.
          }
        }, { once: true });
      }
      return nativeSend.apply(this, args);
    };

    Object.defineProperty(Xhr.prototype, '__e3iFirstLoginPatched', { value: true });
  }

  watchLoginForm();
  patchXmlHttpRequest();

  window.fetch = async (...args) => {
    const request = args[0];
    const url = getRequestUrl(request);
    const response = await nativeFetch(...args);
    try {
      if (url.includes('/api/auth/login') && response.status === 428) {
        const payload = await response.clone().json().catch(() => ({}));
        handleLoginPayload(response.status, payload);
      }
    } catch {
      // O login principal continua recebendo a resposta original.
    }
    return response;
  };
})();
