'use client';

import Link from 'next/link';
import { BrandHomeLink } from '@/components/brand-home-link';
import { OAuthButtons, useAuth } from '@/components/auth-provider';

export function AuthLoginPanel({ returnTo, failed }: { returnTo: string; failed: boolean }) {
  const { user } = useAuth();
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <BrandHomeLink />
      <section className="mt-6 rounded-3xl border border-line bg-surface p-5">
        <h1 className="text-2xl font-bold">로그인 / 가입</h1>
        <p className="my-4 text-sm leading-relaxed text-muted">질문을 올리고 의견을 나누려면 로그인해주세요.</p>
        {failed ? <p role="alert" className="mb-4 text-sm text-danger">로그인을 완료하지 못했어요. 다시 시도해주세요.</p> : null}
        {user ? <Link href={returnTo} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white">원래 페이지로 돌아가기</Link> : <OAuthButtons returnTo={returnTo} />}
      </section>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-sm text-muted">홈으로</Link>
    </main>
  );
}
