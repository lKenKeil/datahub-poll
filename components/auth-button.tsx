'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';

export function AuthButton() {
  const { user, loading, profile, openLogin, signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!user) return <button type="button" disabled={loading} onClick={() => openLogin()} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-line px-2 text-xs font-bold text-ink sm:px-3 sm:text-sm disabled:opacity-60">로그인</button>;
  const name = profile?.nickname ?? '내 계정';
  const logout = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    if (!await signOut()) setError('로그아웃하지 못했어요. 다시 시도해주세요.');
    setPending(false);
  };
  return (
    <details className="relative shrink-0">
      <summary aria-label={`${name} 계정 메뉴`} className="flex min-h-11 min-w-11 max-w-20 cursor-pointer list-none items-center rounded-xl border border-line px-2 text-xs font-bold sm:max-w-28 sm:px-3 sm:text-sm"><span className="truncate">{name}</span></summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-52 max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-surface p-3 shadow-lg">
        <p className="break-words text-xs text-muted">{name}</p>
        <Link href="/profile" className="mt-2 flex min-h-11 items-center rounded-xl px-3 text-sm font-medium">프로필 설정</Link>
        <button type="button" disabled={pending} aria-busy={pending} onClick={() => void logout()} className="mt-2 min-h-11 w-full rounded-xl border border-line text-sm font-bold disabled:opacity-60">{pending ? '로그아웃 중...' : '로그아웃'}</button>
        <p aria-live="polite" className="text-xs text-danger">{error}</p>
      </div>
    </details>
  );
}
