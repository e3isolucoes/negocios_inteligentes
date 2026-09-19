import { escapeHtml } from '../dateUtils.js';

let stackEl = null;

function ensureStack() {
  if (stackEl) return stackEl;
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  stackEl.setAttribute('role', 'status');
  stackEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(stackEl);
  return stackEl;
}

// tone: 'success' | 'error' | 'info'
export function showToast(message, tone = 'info', durationMs = 4500) {
  const stack = ensureStack();
  const el = document.createElement('div');
  el.className = `toast tone-${tone}`;
  el.innerHTML = `<span class="msg">${escapeHtml(message)}</span><button class="close" type="button" aria-label="Fechar aviso">×</button>`;
  stack.appendChild(el);

  const remove = () => {
    el.style.animation = 'none';
    el.remove();
  };
  el.querySelector('.close').addEventListener('click', remove);
  if (durationMs > 0) setTimeout(remove, durationMs);
}
