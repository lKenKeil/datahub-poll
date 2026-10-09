export type LoginProvider = 'google' | 'kakao' | 'email';
export type OAuthProvider = Exclude<LoginProvider, 'email'>;
export type AuthFlowMode = 'login' | 'link';

export function isLoginProvider(value: unknown): value is LoginProvider {
  return value === 'google' || value === 'kakao' || value === 'email';
}

export const LAST_LOGIN_PROVIDER_KEY = 'askio_last_login_provider';
export const LAST_LOGIN_PROVIDER_EVENT = 'askio:last-login-provider';

export function getLastLoginProvider(): LoginProvider | null {
  try {
    const value = window.localStorage.getItem(LAST_LOGIN_PROVIDER_KEY);
    return isLoginProvider(value) ? value : null;
  } catch { return null; }
}

// Convenience only: never use this preference as proof of authentication.
export function rememberLoginProvider(provider: LoginProvider) {
  try {
    window.localStorage.setItem(LAST_LOGIN_PROVIDER_KEY, provider);
    window.dispatchEvent(new Event(LAST_LOGIN_PROVIDER_EVENT));
  } catch { /* Private browsing or disabled storage must not break sign-in. */ }
}

export function subscribeLoginProvider(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(LAST_LOGIN_PROVIDER_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(LAST_LOGIN_PROVIDER_EVENT, callback);
  };
}
