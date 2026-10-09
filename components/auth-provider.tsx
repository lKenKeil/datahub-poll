'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAuthBrowserClient } from '@/lib/supabase-auth-browser';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { EmailAuthForm } from '@/components/auth-email-form';
import { ProfileOnboarding } from '@/components/profile-onboarding';
import { parseAccountProfile, type AccountProfile } from '@/lib/profile';
import { PolicyLinks } from '@/components/policy-links';
import { consumeSuccessfulLoginProvider, startOAuthFlow } from '@/lib/auth-flow-client';
import { getLastLoginProvider, subscribeLoginProvider } from '@/lib/auth-flow';

type LoginRequest = { message: string; returnTo: string };
type AuthState = {
  user: User | null;
  loading: boolean;
  profile: AccountProfile | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<AccountProfile | null>;
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
  const [emailPending, setEmailPending] = useState(false);
  const recentProvider = useSyncExternalStore(subscribeLoginProvider, getLastLoginProvider, () => null);
  const inFlight = useRef(false);
  const signIn = async (provider: 'google' | 'kakao') => {
    if (inFlight.current || emailPending) return;
    inFlight.current = true;
    setPending(provider);
    setError('');
    try {
      const result = await startOAuthFlow({ mode: 'login', provider, returnTo });
      if (!result.ok) throw new Error('OAuth could not start.');
    } catch {
      setError('로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.');
      inFlight.current = false;
      setPending(null);
    }
  };
  return (
    <div className="space-y-3" aria-busy={pending !== null}>
      {recentProvider ? <p className="text-xs text-muted">최근 사용: {recentProvider === 'google' ? 'Google' : recentProvider === 'kakao' ? '카카오' : '이메일'}</p> : null}
      <button type="button" disabled={pending !== null || emailPending} onClick={() => void signIn('google')} className="min-h-11 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-bold text-ink disabled:opacity-60">{pending === 'google' ? '연결 중...' : 'Google로 계속하기'}</button>
      <button type="button" disabled={pending !== null || emailPending} onClick={() => void signIn('kakao')} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-60">{pending === 'kakao' ? '연결 중...' : '카카오로 계속하기'}</button>
      <div className="flex items-center gap-3 py-1 text-xs text-muted"><span className="h-px flex-1 bg-line" /><span>또는</span><span className="h-px flex-1 bg-line" /></div>
      <EmailAuthForm returnTo={returnTo} disabled={pending !== null} onBusyChange={setEmailPending} />
      <p className="text-xs leading-relaxed text-muted">처음 이용해도 로그인 과정에서 자동으로 가입돼요.</p>
      <PolicyLinks newTab />
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
    // Close through Escape or the button, not the cleanup's native close event:
    // Strict Mode closes and reopens the dialog while replaying this effect.
    <dialog ref={ref} onCancel={close} aria-labelledby="auth-dialog-title" aria-describedby="auth-dialog-message" className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-sm overflow-y-auto rounded-3xl border border-line bg-surface p-5 text-ink backdrop:bg-black/45">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id="auth-dialog-title" className="text-xl font-bold">로그인 / 가입</h2>
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
  const [profileState, setProfileState] = useState<{ userId: string; data: AccountProfile | null } | null>(null);
  const [dismissedOnboarding, setDismissedOnboarding] = useState<string | null>(null);
  const currentUserId = useRef<string | null>(null);
  const profileRequestVersion = useRef(0);
  const userId = user?.id ?? null;
  const profile = profileState?.userId === userId ? profileState.data : null;
  const profileLoading = Boolean(userId && profileState?.userId !== userId);

  const refreshProfile = useCallback(async () => {
    if (!userId) return null;
    const version = ++profileRequestVersion.current;
    try {
      const response = await fetch('/api/profile', { cache: 'no-store' });
      const json = response.ok ? await response.json() : null;
      const data = parseAccountProfile(json?.data);
      if (currentUserId.current === userId && profileRequestVersion.current === version) setProfileState({ userId, data });
      return data;
    } catch {
      if (currentUserId.current === userId && profileRequestVersion.current === version) setProfileState({ userId, data: null });
      return null;
    }
  }, [userId]);

  useEffect(() => {
    if (userId) void consumeSuccessfulLoginProvider();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const version = ++profileRequestVersion.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/profile', { signal: controller.signal, cache: 'no-store' });
        const json = response.ok ? await response.json() : null;
        if (!controller.signal.aborted && profileRequestVersion.current === version) setProfileState({ userId, data: parseAccountProfile(json?.data) });
      } catch {
        if (!controller.signal.aborted && profileRequestVersion.current === version) setProfileState({ userId, data: null });
      }
    })();
    return () => { controller.abort(); };
  }, [userId]);

  useEffect(() => {
    let active = true;
    let version = 0;
    try {
      const client = getSupabaseAuthBrowserClient();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        version += 1;
        if (!active) return;
        currentUserId.current = session?.user && !session.user.is_anonymous ? session.user.id : null;
        setUser(session?.user && !session.user.is_anonymous ? session.user : null);
        setLoading(false);
        if (session?.user && !session.user.is_anonymous) setLoginRequest(null);
      });
      const initialVersion = version;
      void client.auth.getUser().then(({ data, error }) => {
        if (!active || initialVersion !== version) return;
        currentUserId.current = !error && data.user && !data.user.is_anonymous ? data.user.id : null;
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
    // Capture the page that opened this dialog before leaving for any provider.
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    setLoginRequest({ message, returnTo: getSafeAuthReturnPath(returnTo ?? currentPath) });
  }, []);
  const signOut = useCallback(async () => {
    try {
      const { error } = await getSupabaseAuthBrowserClient().auth.signOut();
      if (error) return false;
      currentUserId.current = null;
      setUser(null);
      return true;
    } catch { return false; }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, profile, profileLoading, refreshProfile, openLogin, signOut }}>
      {children}
      {loginRequest ? <AuthDialog request={loginRequest} close={() => setLoginRequest(null)} /> : null}
      {userId && profile && !profile.onboarding_completed && dismissedOnboarding !== userId && !loginRequest
        ? <ProfileOnboarding profile={profile} close={() => setDismissedOnboarding(userId)} /> : null}
    </AuthContext.Provider>
  );
}
