import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMEMBER_KEY,
  rememberedAccount,
  rememberAccount,
  TOKEN_KEY,
  savedToken,
  saveToken,
  autoLogin,
  setAutoLogin
} from '../cloud/login-preferences.mjs';
const memory = () => {
  const values = new Map();
  return {
    getItem: k => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: k => values.delete(k),
    values
  };
};
test('no account is remembered by default', () => assert.equal(rememberedAccount(memory()), ''));
test('only an email is persisted', () => {
  const s = memory();
  assert.equal(rememberAccount(s, 'sample@example.com'), true);
  assert.deepEqual(JSON.parse(s.getItem(REMEMBER_KEY)), { email: 'sample@example.com' });
  assert.equal(rememberedAccount(s), 'sample@example.com');
  assert.equal(s.values.size, 1);
});
test('forget removes the identity', () => {
  const s = memory();
  rememberAccount(s, 'sample@example.com');
  rememberAccount(s, '');
  assert.equal(s.values.size, 0);
});
test('malformed settings never become a login hint', () => {
  const s = memory();
  for (const v of ['invalid', 'null', '{"email":123}', '{"email":"not an email"}']) {
    s.setItem(REMEMBER_KEY, v);
    assert.equal(rememberedAccount(s), '');
  }
});
test('blocked storage does not prevent connection', () => {
  const s = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
    removeItem() {
      throw Error('blocked');
    }
  };
  assert.equal(rememberedAccount(s), '');
  assert.equal(rememberAccount(s, 'sample@example.com'), false);
  assert.equal(rememberedAccount(null), '');
});

test('a saved token is used only while it still has more than a minute left', () => {
  const s = memory();
  const now = 1_000_000;
  assert.equal(savedToken(s, now), null);
  saveToken(s, 'tok', now + 30 * 60000);
  assert.deepEqual(savedToken(s, now), { token: 'tok', expires: now + 30 * 60000 });
  assert.equal(savedToken(s, now + 30 * 60000 - 30000), null); // under a minute left
  assert.equal(s.values.has(TOKEN_KEY), false); // an expired token is removed
  saveToken(s, 'tok', now + 30 * 60000);
  saveToken(s, '', 0); // sign-out
  assert.equal(s.values.size, 0);
  for (const v of ['bad', '{"token":1,"expires":9e15}', '{"token":"t"}']) {
    s.setItem(TOKEN_KEY, v);
    assert.equal(savedToken(s, now), null);
    assert.equal(s.values.size, 0);
  }
});
test('signing in on the first tap is off until a sign-in and off again after sign-out', () => {
  const s = memory();
  assert.equal(autoLogin(s), false);
  setAutoLogin(s, true);
  assert.equal(autoLogin(s), true);
  setAutoLogin(s, false);
  assert.equal(autoLogin(s), false);
  assert.equal(s.values.size, 0);
});
