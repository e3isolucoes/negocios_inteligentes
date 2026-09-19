import {
  getSignInErrorMessage, sendPasswordResetEmail, signIn, updateOwnPassword,
} from '../api/auth.js';

export function showLogin(message) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('resetPasswordScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  const errEl = document.getElementById('portalLoginStatus') || document.getElementById('loginError');
  if (message) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
  } else {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }
}

// Mostrada quando alguém chega pelo link de redefinição de senha (evento
// PASSWORD_RECOVERY, ver js/app.js) — em vez de entrar direto no painel
// com a sessão temporária do link, pede pra pessoa escolher a senha nova.
export function showResetPasswordScreen(message) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('resetPasswordScreen').classList.remove('hidden');
  const errEl = document.getElementById('resetPasswordError');
  if (message) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
}

export function wireResetPasswordScreen(onSaved) {
  const passEl = document.getElementById('newPasswordInput');
  const codeEl = document.getElementById('resetCodeInput');
  const btn = document.getElementById('resetPasswordBtn');

  async function attemptSave() {
    const password = passEl.value;
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) { showResetPasswordScreen('Use pelo menos 8 caracteres, uma letra maiúscula e um número.'); return; }
    if (!codeEl.value.trim()) { showResetPasswordScreen('Informe o código recebido por e-mail.'); return; }

    btn.disabled = true;
    btn.textContent = 'Salvando…';
    try {
      await updateOwnPassword(password, codeEl.value.trim());
      passEl.value = '';
      codeEl.value = '';
      onSaved();
    } catch (err) {
      console.error(err);
      showResetPasswordScreen('Não foi possível salvar a senha agora — o link pode ter expirado. Peça um novo link ao administrador.');
    }
    btn.disabled = false;
    btn.textContent = 'Salvar nova senha';
  }

  btn.addEventListener('click', attemptSave);
  passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptSave(); });
}

export function wireLogin() {
  const form = document.getElementById('loginForm');
  const emailEl = document.getElementById('loginEmail');
  const passEl = document.getElementById('loginPassword');
  const btn = document.getElementById('loginBtn');
  const toggle = document.getElementById('passwordToggle');
  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const capsLockHint = document.getElementById('capsLockHint');

  async function attemptLogin() {
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password || !emailEl.validity.valid) {
      showLogin(!emailEl.validity.valid && email ? 'Informe um e-mail válido.' : 'Informe e-mail e senha.');
      (!email || !emailEl.validity.valid ? emailEl : passEl).focus();
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>Verificando acesso…</span><span class="login-spinner" aria-hidden="true"></span>';
    try {
      const { error } = await signIn(email, password);
      if (error) { showLogin(getSignInErrorMessage(error)); }
      // onAuthStateChange cuida de mostrar o app quando o login der certo.
    } catch (error) {
      console.error('Falha ao autenticar no Supabase', error);
      showLogin(getSignInErrorMessage(error));
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>Entrar no painel</span><span aria-hidden="true">→</span>';
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); attemptLogin(); });
  toggle.addEventListener('click', () => {
    const showing = passEl.type === 'text';
    passEl.type = showing ? 'password' : 'text';
    toggle.textContent = showing ? 'Mostrar senha' : 'Ocultar senha';
    toggle.setAttribute('aria-pressed', String(!showing));
    passEl.focus();
  });
  passEl.addEventListener('keyup', (event) => {
    capsLockHint.classList.toggle('hidden', !event.getModifierState('CapsLock'));
  });
  passEl.addEventListener('blur', () => capsLockHint.classList.add('hidden'));
  forgotBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!email || !emailEl.validity.valid) {
      showLogin('Informe seu e-mail corporativo para recuperar a senha.');
      emailEl.focus();
      return;
    }
    forgotBtn.disabled = true;
    forgotBtn.textContent = 'Enviando instruções…';
    try {
      await sendPasswordResetEmail(email);
      // Mensagem neutra: não revela se o e-mail está ou não cadastrado.
      showResetPasswordScreen('Se este e-mail estiver cadastrado, o código foi enviado pela AWS.');
    } catch (error) {
      console.error('Falha ao solicitar redefinição de senha', error);
      showLogin('Não foi possível solicitar a redefinição agora. Aguarde alguns minutos e tente novamente.');
    } finally {
      forgotBtn.disabled = false;
      forgotBtn.textContent = 'Esqueci minha senha';
    }
  });
}
