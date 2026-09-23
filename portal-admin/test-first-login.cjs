const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = process.env.E3I_FIRST_LOGIN_DIR || __dirname;
const firstLogin = fs.readFileSync(path.join(root, 'first-login.js'), 'utf8');
const firstLoginCss = fs.readFileSync(path.join(root, 'first-login.css'), 'utf8');

assert.match(firstLogin, /data-e3i-cancel/, 'primeiro acesso deve oferecer botão Cancelar');
assert.match(firstLogin, /function closeFirstLogin\(/, 'cancelamento deve usar uma rotina única de fechamento');
assert.match(firstLogin, /clearFirstLoginFields\(modal\)/, 'fechamento deve limpar código e senhas');
assert.match(firstLogin, /currentEmail = ''/, 'fechamento deve limpar o e-mail transitório do modal');
assert.match(firstLogin, /cancel\.addEventListener\('click',[\s\S]*?closeFirstLogin\(/, 'botão Cancelar deve fechar sem submit');
assert.match(firstLogin, /event\.target === wrapper[\s\S]*?closeFirstLogin\(/, 'clique no fundo deve seguir a mesma lógica de cancelamento');
assert.match(firstLogin, /event\.key !== 'Escape'[\s\S]*?closeFirstLogin\(/, 'Escape deve seguir a mesma lógica de cancelamento');
assert.match(firstLogin, /returnFocus = document\.activeElement/, 'modal deve lembrar o foco anterior');
assert.match(firstLogin, /target\.focus\(\)/, 'cancelamento deve restaurar o foco anterior');
assert.match(firstLoginCss, /\.e3i-secondary-button/, 'Cancelar deve usar ação secundária consistente');
assert.match(firstLoginCss, /\.e3i-first-login-primary-actions/, 'ações principal e secundária devem permanecer agrupadas');

const closeStart = firstLogin.indexOf('function closeFirstLogin');
const closeEnd = firstLogin.indexOf('function ensureModal', closeStart);
assert.ok(closeStart >= 0 && closeEnd > closeStart, 'rotina de fechamento deve ser isolável');
const closeSource = firstLogin.slice(closeStart, closeEnd);
assert.doesNotMatch(closeSource, /nativeFetch|fetch\s*\(/, 'Cancelar não pode chamar backend nem alterar autenticação');

for (const similar of ['admin-central.html', 'admin-ferramentas.html']) {
  const file = path.join(root, similar);
  if (!fs.existsSync(file)) continue;
  assert.match(fs.readFileSync(file, 'utf8'), />Cancelar</, `${similar} deve manter ação explícita de cancelamento`);
}

console.log('PORTAL_FIRST_LOGIN_CANCEL_VALIDATION_OK');
