import { getSupabaseAuthBrowserClient } from '@/lib/supabase-auth-browser';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { isLoginProvider, rememberLoginProvider, type AuthFlowMode, type LoginProvider, type OAuthProvider } from '@/lib/auth-flow';

export async function prepareAuthFlow(mode: AuthFlowMode, provider: LoginProvider, returnTo: string) {
  const response = await fetch('/api/auth/flow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', cache: 'no-store',
    body: JSON.stringify({ action: 'start', mode, provider, returnTo: getSafeAuthReturnPath(returnTo) }),
  });
  return response.ok && (await response.json()).ok === true;
}

type FlowResult = { ok: true } | { ok: false; code: 'identity_already_exists' | 'link_failed' | 'login_failed'; message: string };
export async function startOAuthFlow({ mode, provider, returnTo }: {
  mode: AuthFlowMode; provider: OAuthProvider; returnTo: string;
}): Promise<FlowResult> {
  const failed = (conflict = false): FlowResult => ({
    ok: false,
    code: conflict ? 'identity_already_exists' : mode === 'link' ? 'link_failed' : 'login_failed',
    message: conflict ? '이 로그인 방법은 이미 다른 Askio 계정에 연결되어 있어요.'
      : mode === 'link' ? '로그인 방법을 연결하지 못했어요. 잠시 후 다시 시도해주세요.'
        : '로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.',
  });
  try {
    if (!await prepareAuthFlow(mode, provider, returnTo)) return failed();
    const client = getSupabaseAuthBrowserClient();
    const redirectTo = new URL(mode === 'link' ? '/auth/callback/link' : '/auth/callback', window.location.origin).toString();
    const credentials = { provider, options: { redirectTo, skipBrowserRedirect: true } };
    const { data, error } = mode === 'link'
      ? await client.auth.linkIdentity(credentials)
      : await client.auth.signInWithOAuth(credentials);
    if (error || !data.url) {
      // No raw provider errors, emails, codes or token URLs enter UI or logs.
      await fetch('/api/auth/flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) }).catch(() => {});
      return failed(mode === 'link' && error?.code === 'identity_already_exists');
    }
    window.location.assign(data.url);
    return { ok: true };
  } catch { return failed(); }
}

export async function finishEmailAuthFlow(returnTo: string): Promise<string> {
  // Called only after verifyOtp returned a session. Preference is not identity.
  rememberLoginProvider('email');
  try {
    const response = await fetch('/api/auth/flow', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete-email' }),
    });
    if (response.ok) {
      const data = await response.json();
      return getSafeAuthReturnPath(data.returnTo);
    }
  } catch { /* Successful OTP remains usable even if the return helper fails. */ }
  return getSafeAuthReturnPath(returnTo);
}

export async function consumeSuccessfulLoginProvider() {
  try {
    const response = await fetch('/api/auth/flow', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recent-provider' }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (isLoginProvider(data.provider)) rememberLoginProvider(data.provider);
  } catch { /* Recency is non-critical and has no bearing on the session. */ }
}
