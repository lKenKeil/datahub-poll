'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseAuthBrowserClient } from '@/lib/supabase-auth-browser';
import { normalizeLoginEmail, sendEmailLoginCode, verifyEmailLoginCode } from '@/lib/email-auth';
import { finishEmailAuthFlow, prepareAuthFlow } from '@/lib/auth-flow-client';

export function EmailAuthForm({ returnTo, disabled, onBusyChange }: {
  returnTo: string; disabled: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const inFlight = useRef(false);
  const blocked = pending || disabled;

  useEffect(() => {
    if (!resendAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const sendCode = async () => {
    if (blocked || inFlight.current || Date.now() < resendAt) return;
    const normalized = normalizeLoginEmail(email);
    if (!normalized) { setError('이메일 주소를 확인해주세요.'); return; }
    inFlight.current = true;
    setPending(true);
    onBusyChange(true);
    setError('');
    // Client cooldown is convenience only. Supabase enforces provider-side
    // per-address, per-IP and project limits even when this UI is bypassed.
    setResendAt(Date.now() + 60_000);
    setRemaining(60);
    try {
      if (!await prepareAuthFlow('login', 'email', returnTo)) throw new Error('Login flow could not start.');
      const ok = await sendEmailLoginCode(getSupabaseAuthBrowserClient(), normalized);
      if (ok) { setSentEmail(normalized); setCode(''); }
      else setError('인증 메일을 요청하지 못했어요. 잠시 후 다시 시도해주세요.');
    } catch { setError('인증 메일을 요청하지 못했어요. 잠시 후 다시 시도해주세요.'); }
    finally { inFlight.current = false; setPending(false); onBusyChange(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sentEmail) { await sendCode(); return; }
    if (blocked || inFlight.current) return;
    if (!/^\d{6}$/.test(code)) { setError('6자리 인증 코드를 입력해주세요.'); return; }
    inFlight.current = true;
    setPending(true);
    onBusyChange(true);
    setError('');
    try {
      const ok = await verifyEmailLoginCode(getSupabaseAuthBrowserClient(), sentEmail, code);
      if (!ok) { setError('인증 코드를 확인해주세요. 만료됐다면 다시 요청해주세요.'); return; }
      router.replace(await finishEmailAuthFlow(returnTo));
      router.refresh();
    } catch { setError('인증을 완료하지 못했어요. 잠시 후 다시 시도해주세요.'); }
    finally { inFlight.current = false; setPending(false); onBusyChange(false); }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3" aria-busy={pending}>
      {sentEmail ? <>
        <p className="text-sm leading-relaxed text-muted">메일로 받은 6자리 인증 코드를 입력해주세요.</p>
        <label htmlFor={`${inputId}-code`} className="block text-sm font-medium">인증 코드</label>
        <input id={`${inputId}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={blocked} required className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-base tracking-widest text-ink" />
        <button type="submit" disabled={blocked} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? '확인 중...' : '로그인 / 가입'}</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={blocked || remaining > 0} onClick={() => void sendCode()} className="min-h-11 rounded-xl px-3 text-xs text-muted disabled:opacity-60">{remaining > 0 ? `${remaining}초 후 다시 보내기` : '코드 다시 보내기'}</button>
          <button type="button" disabled={blocked} onClick={() => { setSentEmail(null); setCode(''); setError(''); }} className="min-h-11 rounded-xl px-3 text-xs text-muted">이메일 변경</button>
        </div>
      </> : <>
        <label htmlFor={`${inputId}-email`} className="block text-sm font-medium">이메일 주소</label>
        <input id={`${inputId}-email`} type="email" autoComplete="email" placeholder="example@email.com" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={blocked} required className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink" />
        <button type="submit" disabled={blocked || remaining > 0} className="min-h-11 w-full rounded-xl border border-line px-4 py-3 text-sm font-bold text-ink disabled:opacity-60">{pending ? '요청 중...' : remaining > 0 ? `${remaining}초 후 다시 요청` : '이메일로 계속하기'}</button>
      </>}
      <p aria-live="polite" className="text-sm text-danger">{error}</p>
    </form>
  );
}
