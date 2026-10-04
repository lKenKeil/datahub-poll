'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAuthBrowserClient } from '@/lib/supabase-auth-browser';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';

type LoginRequest = { message: string; returnTo: string };
type AuthState = {
  user: User | null;
  loading: boolean;
  openLogin: (message?: string, returnTo?: string) => void;
  signOut: () => Promise<boolean>;
};
const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}

export function OAuthButtons({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState<'google' | 'kakao' | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const signIn = async (provider: 'google' | 'kakao') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(provider);
    setError('');
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('next', getSafeAuthReturnPath(returnTo));
      const { data, error: authError } = await getSupabaseAuthBrowserClient().auth.signInWithOAuth({
        provider, options: { redirectTo: callback.toString() },
      });
      if (authError || !data.url) throw new Error('OAuth could not start.');
    } catch {
      setError('로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
      inFlight.current = false;
      setPending(null);
    }
  };
  return (
    <div className="space-y-3" aria-busy={pending !== null}>
      <button type="button" disabled={pending !== null} onClick={() => void signIn('google')} className="min-h-11 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-bold text-ink disabled:opacity-60">{pending === 'google' ? '연결 중...' : 'Google로 계속하기'}</button>
      <button type="button" disabled={pending !== null} onClick={() => void signIn('kakao')} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-60">{pending === 'kakao' ? '연결 중...' : '카카오로 계속하기'}</button>
      <p aria-live="polite" className="text-sm text-danger">{error}</p>
    </div>
  );
}

function AuthDialog({ request, close }: { request: LoginRequest; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return (
    <dialog ref={ref} onCancel={close} onClose={close} aria-labelledby="auth-dialog-title" aria-describedby="auth-dialog-message" className="m-auto w-[calc(100%-32px)] max-w-sm rounded-3xl border border-line bg-surface p-5 text-ink backdrop:bg-black/45">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id="auth-dialog-title" className="text-xl font-bold">로그인</h2>
        <button type="button" onClick={close} aria-label="로그인 안내 닫기" className="min-h-11 min-w-11 rounded-xl text-muted">닫기</button>
      </div>
      <p id="auth-dialog-message" className="mb-5 text-sm leading-relaxed text-muted">{request.message}</p>
      <OAuthButtons returnTo={request.returnTo} />
    </dialog>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginRequest, setLoginRequest] = useState<LoginRequest | null>(null);

  useEffect(() => {
    let active = true;
    let version = 0;
    try {
      const client = getSupabaseAuthBrowserClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        version += 1;
        if (!active) return;
        setUser(session?.user && !session.user.is_anonymous ? session.user : null);
        setLoading(false);
        if (session?.user && !session.user.is_anonymous) setLoginRequest(null);
      });
      const initialVersion = version;
      void client.auth.getUser().then(({ data, error }) => {
        if (!active || initialVersion !== version) return;
        setUser(!error && data.user && !data.user.is_anonymous ? data.user : null);
        setLoading(false);
      }).catch(() => { if (active && initialVersion === version) { setUser(null); setLoading(false); } });
      return () => { active = false; subscription.unsubscribe(); };
    } catch {
      void Promise.resolve().then(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }
  }, []);

  const openLogin = useCallback((message = '사람들과 궁금증을 나누려면 로그인해주세요.', returnTo?: string) => {
    // Default is pathname only: never forward private/query-string credentials.
    setLoginRequest({ message, returnTo: getSafeAuthReturnPath(returnTo ?? window.location.pathname) });
  }, []);
  const signOut = useCallback(async () => {
    try {
      const { error } = await getSupabaseAuthBrowserClient().auth.signOut();
      if (error) return false;
      setUser(null);
      return true;
    } catch { return false; }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, openLogin, signOut }}>
      {children}
      {loginRequest ? <AuthDialog request={loginRequest} close={() => setLoginRequest(null)} /> : null}
    </AuthContext.Provider>
  );
}
