import test from 'node:test';
import assert from 'node:assert/strict';

import { getSignInErrorMessage, isPasswordRecoveryUrl } from '../js/api/auth.js';

test('orienta a confirmar uma conta ainda não confirmada', () => {
  assert.match(
    getSignInErrorMessage({ code: 'email_not_confirmed', status: 400 }),
    /ainda não foi confirmado/,
  );
});

test('diferencia limite de tentativas de credenciais incorretas', () => {
  assert.match(getSignInErrorMessage({ status: 429 }), /Muitas tentativas/);
  assert.match(
    getSignInErrorMessage({ code: 'invalid_credentials', status: 400 }),
    /mesmo projeto Supabase/,
  );
});

test('usa uma mensagem segura para falhas desconhecidas ou de rede', () => {
  assert.match(getSignInErrorMessage(new TypeError('Failed to fetch')), /conexão/);
});

test('reconhece links de recuperação no fragmento ou na query string', () => {
  assert.equal(isPasswordRecoveryUrl({ hash: '#access_token=token&type=recovery', search: '' }), true);
  assert.equal(isPasswordRecoveryUrl({ hash: '', search: '?code=abc&type=recovery' }), true);
  assert.equal(isPasswordRecoveryUrl({ hash: '#access_token=token&type=signup', search: '' }), false);
});
