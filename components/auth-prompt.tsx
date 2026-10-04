'use client';

import { useAuth } from '@/components/auth-provider';

export function AuthPrompt({ message, returnTo }: { message: string; returnTo?: string }) {
  const { loading, openLogin } = useAuth();
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" aria-busy={loading}>
      <p className="text-sm font-medium text-ink">{loading ? '로그인 상태를 확인하고 있어요.' : message}</p>
      <button type="button" disabled={loading} onClick={() => openLogin(message, returnTo)} className="mt-3 min-h-11 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-60">로그인</button>
    </section>
  );
}
