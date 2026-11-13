// Google 登入：載入 Google 官方授權元件，按下按鈕時才跳出授權視窗。Token 只放在記憶體。
import { GOOGLE_CLIENT_ID } from './config.mjs';

let gisPromise = null;
export function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise)
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        gisPromise = null;
        script.remove();
        reject(Error('GOOGLE_NETWORK'));
      };
      document.head.append(script);
    });
  return gisPromise;
}

// Ask for a token. Must be called from a click so Safari allows the popup.
export function requestToken({ scope, hint = '', chooser = false }) {
  return new Promise((resolve, reject) => {
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID))
      return reject(Error('GOOGLE_CONFIG'));
    if (!globalThis.google?.accounts?.oauth2) return reject(Error('GOOGLE_NOT_READY'));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      include_granted_scopes: false,
      ...(hint && !chooser ? { login_hint: hint } : {}),
      callback: response => {
        if (
          response.error ||
          !response.access_token ||
          !google.accounts.oauth2.hasGrantedAllScopes(response, scope)
        )
          reject(Error('GOOGLE_PERMISSION'));
        else resolve(response);
      },
      error_callback: () => reject(Error('GOOGLE_POPUP'))
    });
    try {
      client.requestAccessToken({ prompt: hint && !chooser ? '' : 'select_account' });
    } catch {
      reject(Error('GOOGLE_POPUP'));
    }
  });
}
