'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { parseAccountProfile, type AccountProfile } from '@/lib/profile';

export function ProfileEditor({ profile, onboarding = false, onComplete }: {
  profile: AccountProfile; onboarding?: boolean; onComplete?: () => void;
}) {
  const { refreshProfile } = useAuth();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [nickname, setNickname] = useState(profile.nickname);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const changeProfile = async (recommend: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/profile', {
        method: recommend ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recommend ? { action: 'recommend' } : { nickname, onboardingCompleted: true }),
      });
      const json = await response.json();
      if (!response.ok) {
        // Only known validation/conflict messages belong in the UI.
        if (response.status === 409) setError('이미 사용 중인 닉네임이에요. 다른 이름을 골라주세요.');
        else if (response.status === 400) setError('닉네임은 한글·영문·숫자·밑줄로 2~16자 입력해주세요. 운영자 명칭은 사용할 수 없어요.');
        else if (response.status === 429) setError('변경 요청이 너무 많아요. 잠시 후 다시 시도해주세요.');
        else if (response.status === 401) setError('다시 로그인해주세요.');
        else setError('프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      const saved = parseAccountProfile(json.data);
      if (!saved) throw new Error('Invalid profile response.');
      setNickname(saved.nickname);
      await refreshProfile();
      if (recommend) setMessage('새 이름을 추천했어요. 직접 바꿔도 괜찮아요.');
      else { setMessage('프로필을 저장했어요.'); onComplete?.(); }
    } catch { setError('프로필을 저장하지 못했어요. 잠시 후 다시 시도해주세요.'); }
    finally { inFlight.current = false; setPending(false); }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void changeProfile(false); };
  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-bold">닉네임</label>
        <input ref={input} id={id} type="text" value={nickname} onChange={(event) => setNickname(event.target.value)} autoComplete="nickname" minLength={2} maxLength={16} required disabled={pending} aria-describedby={`${id}-help`} className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink" />
        <p id={`${id}-help`} className="mt-2 text-xs leading-relaxed text-muted">한글·영문·숫자·밑줄, 2~16자. 실명 대신 편한 이름을 사용하세요.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => void changeProfile(true)} className="min-h-11 rounded-xl border border-line px-3 text-sm font-medium disabled:opacity-60">다른 이름 추천</button>
        {onboarding ? <button type="button" disabled={pending} onClick={() => input.current?.focus()} className="min-h-11 rounded-xl px-3 text-sm font-medium disabled:opacity-60">직접 수정</button> : null}
      </div>
      <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{pending ? '저장 중...' : onboarding && nickname === profile.nickname ? '이대로 시작' : '저장'}</button>
      <div aria-live="polite" className="text-sm leading-relaxed"><p className="text-danger">{error}</p><p className="text-muted">{message}</p></div>
    </form>
  );
}
