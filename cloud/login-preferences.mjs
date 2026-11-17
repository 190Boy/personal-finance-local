export const REMEMBER_KEY = 'finance-remembered-account-v1';
const email = value =>
  typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
export function rememberedAccount(storage) {
  try {
    return email(JSON.parse(storage.getItem(REMEMBER_KEY) || 'null')?.email);
  } catch {
    return '';
  }
}
export function rememberAccount(storage, value) {
  const valid = email(value);
  try {
    if (valid) storage.setItem(REMEMBER_KEY, JSON.stringify({ email: valid }));
    else storage.removeItem(REMEMBER_KEY);
    return true;
  } catch {
    return false;
  }
}

// Keep the short-lived Google access token (about 1 hour) so reopening the app within that time
// needs no sign-in. Only the token and its expiry are kept; it is dropped on sign-out or when it expires.
export const TOKEN_KEY = 'finance-google-token-v1';
export function savedToken(storage, now = Date.now()) {
  try {
    const t = JSON.parse(storage.getItem(TOKEN_KEY) || 'null');
    if (typeof t?.token === 'string' && t.token && Number.isFinite(t.expires) && t.expires > now + 60000)
      return { token: t.token, expires: t.expires };
    if (t) storage.removeItem(TOKEN_KEY);
  } catch {
    try {
      storage.removeItem(TOKEN_KEY);
    } catch {
      // storage unavailable
    }
  }
  return null;
}
export function saveToken(storage, token, expires) {
  try {
    if (token && Number.isFinite(expires)) storage.setItem(TOKEN_KEY, JSON.stringify({ token, expires }));
    else storage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: the app still works, it just asks again
  }
}

// Whether to sign in on the first tap. On after a successful sign-in, off after the user signs out.
export const AUTO_KEY = 'finance-auto-login-v1';
export function autoLogin(storage) {
  try {
    return storage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}
export function setAutoLogin(storage, on) {
  try {
    if (on) storage.setItem(AUTO_KEY, '1');
    else storage.removeItem(AUTO_KEY);
  } catch {
    // storage unavailable
  }
}
