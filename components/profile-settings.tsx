'use client';

import Link from 'next/link';
import { BrandHomeLink } from '@/components/brand-home-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { AuthButton } from '@/components/auth-button';
import { AuthPrompt } from '@/components/auth-prompt';
import { useAuth } from '@/components/auth-provider';
import { ProfileEditor } from '@/components/profile-editor';
import { ProfileLoginMethods } from '@/components/profile-login-methods';

export function ProfileSettings() {
  const { user, loading, profile, profileLoading, refreshProfile } = useAuth();
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-[65px] w-full max-w-2xl items-center justify-between gap-3 px-4"><BrandHomeLink /><div className="flex shrink-0 items-center gap-2"><AuthButton /><ThemeToggle /></div></div>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <Link href="/" className="mb-4 inline-flex min-h-11 items-center text-sm text-muted">← 홈으로</Link>
        <h1 className="mb-2 text-2xl font-bold">프로필 설정</h1>
        <p className="mb-6 text-sm text-muted">의견을 나눌 때 사용할 이름을 정해주세요.</p>
        {loading || profileLoading ? <p role="status" className="text-sm text-muted">프로필을 불러오는 중...</p>
          : !user ? <AuthPrompt message="프로필을 설정하려면 로그인해주세요." returnTo="/profile" />
          : profile ? <section className="rounded-3xl border border-line bg-surface p-5"><ProfileEditor key={user.id} profile={profile} /></section>
          : <div role="status" className="space-y-3"><p className="text-sm text-muted">프로필을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p><button type="button" onClick={() => void refreshProfile()} className="min-h-11 rounded-xl border border-line px-4 text-sm font-medium">다시 불러오기</button></div>}
        {!loading && user ? <ProfileLoginMethods key={user.id} userId={user.id} /> : null}
      </main>
    </div>
  );
}
