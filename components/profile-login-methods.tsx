'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { startOAuthFlow } from '@/lib/auth-flow-client';
import { getIdentityLinkFeedback, getLinkedLoginMethods, type LinkedLoginMethods } from '@/lib/auth-login-methods';
import { getSupabaseAuthBrowserClient } from '@/lib/supabase-auth-browser';

type LoginMethodsState = { loading: boolean; linked: LinkedLoginMethods | null };

export function ProfileLoginMethods({ userId }: { userId: string }) {
  const titleId = useId();
  const [state, setState] = useState<LoginMethodsState>({ loading: true, linked: null });
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<'google' | 'kakao' | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const callbackFeedback = getIdentityLinkFeedback(url.searchParams.get('auth_link'));
    const consumeCallbackFeedback = () => {
      const currentUrl = new URL(window.location.href);
      if (!callbackFeedback || currentUrl.pathname !== url.pathname || currentUrl.searchParams.get('auth_link') !== url.searchParams.get('auth_link')) return;
      currentUrl.searchParams.delete('auth_link');
      window.history.replaceState(window.history.state, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
    };
    void (async () => {
      try {
        const { data, error } = await getSupabaseAuthBrowserClient().auth.getUserIdentities();
        const linked = !error ? getLinkedLoginMethods(data?.identities, userId) : null;
        if (!active) return;
        consumeCallbackFeedback();
        setState({ loading: false, linked });
        if (!linked) setFeedback(callbackFeedback?.error ? callbackFeedback : { error: true, message: '로그인 방법을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
        else if (callbackFeedback) setFeedback(callbackFeedback);
      } catch {
        if (!active) return;
        consumeCallbackFeedback();
        setState({ loading: false, linked: null });
        setFeedback(callbackFeedback?.error ? callbackFeedback : { error: true, message: '로그인 방법을 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
      }
    })();
    return () => { active = false; };
  }, [userId, revision]);

  const link = async (provider: 'google' | 'kakao') => {
    if (inFlight.current || state.loading || !state.linked || state.linked[provider]) return;
    inFlight.current = true;
    setPending(provider);
    setFeedback(null);
    try {
      const { data, error } = await getSupabaseAuthBrowserClient().auth.getUser();
      if (!mounted.current) return;
      if (error || !data.user || data.user.is_anonymous || data.user.id !== userId) {
        setFeedback({ error: true, message: '로그인 상태가 바뀌었어요. 페이지를 새로고침하고 다시 시도해주세요.' });
        inFlight.current = false;
        setPending(null);
        return;
      }
      // Explicit linking to the current authenticated account, never a new
      // sign-in or a custom email-based account merge.
      const result = await startOAuthFlow({ mode: 'link', provider, returnTo: '/profile' });
      if (!mounted.current) return;
      if (!result.ok) {
        setFeedback(getIdentityLinkFeedback(result.code === 'identity_already_exists' ? result.code : 'failed'));
        inFlight.current = false;
        setPending(null);
      }
    } catch {
      if (!mounted.current) return;
      setFeedback(getIdentityLinkFeedback('failed'));
      inFlight.current = false;
      setPending(null);
    }
  };

  return (
    <section aria-labelledby={titleId} aria-busy={state.loading || pending !== null} className="mt-6 rounded-3xl border border-line bg-surface p-5">
      <h2 id={titleId} className="text-lg font-bold">로그인 방법</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">한 Askio 계정에 여러 로그인 방법을 연결할 수 있어요.</p>
      {state.loading ? <p role="status" className="mt-4 text-sm text-muted">로그인 방법을 확인하는 중...</p>
        : state.linked ? <div className="mt-3 divide-y divide-line">
          {(['google', 'kakao'] as const).map(provider => (
            <div key={provider} className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-2">
              <span className="text-sm font-medium">{provider === 'google' ? 'Google' : '카카오'}</span>
              {state.linked?.[provider] ? <span className="text-sm text-muted">연결됨</span>
                : <button type="button" onClick={() => void link(provider)} disabled={pending !== null} aria-label={`${provider === 'google' ? 'Google' : '카카오'} 로그인 방법 연결하기`} className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm font-medium disabled:opacity-60">{pending === provider ? '연결 중...' : '연결하기'}</button>}
            </div>
          ))}
          <div className="flex min-h-14 min-w-0 items-center justify-between gap-3 py-2">
            <span className="shrink-0 text-sm font-medium">이메일 코드</span>
            <span className="text-right text-sm text-muted">{state.linked.email ? '연결됨' : '확인된 연결 없음'}</span>
          </div>
          <p className="pt-3 text-xs leading-relaxed text-muted">연결된 이메일 로그인 정보만 표시해요. 이메일 추가·변경과 로그인 방법 연결 해제는 여기서 제공하지 않아요.</p>
        </div>
          : <button type="button" onClick={() => { setState({ loading: true, linked: null }); setFeedback(null); setRevision(value => value + 1); }} className="mt-4 min-h-11 rounded-xl border border-line px-3 text-sm font-medium">다시 확인하기</button>}
      <p role="status" aria-live="polite" className={`mt-3 text-sm leading-relaxed ${feedback?.error ? 'text-danger' : 'text-muted'}`}>{feedback?.message}</p>
    </section>
  );
}
