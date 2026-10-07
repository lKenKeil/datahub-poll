import type { ReactNode } from 'react';
import { AuthButton } from '@/components/auth-button';
import { BrandHomeLink } from '@/components/brand-home-link';
import { PolicyLinks } from '@/components/policy-links';
import { ThemeToggle } from '@/components/theme-toggle';
import { BRAND } from '@/lib/brand';
import { SERVICE_POLICIES } from '@/lib/service-policies';

export function PolicyDocument({ title, introduction, children }: { title: string; introduction: string; children: ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-[65px] w-full max-w-3xl items-center justify-between gap-3 px-4">
          <BrandHomeLink />
          <div className="flex shrink-0 items-center gap-2"><AuthButton /><ThemeToggle /></div>
        </div>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-8 sm:py-12">
        <article className="space-y-8 break-words text-sm leading-7 text-ink sm:text-base sm:leading-8">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted">{BRAND.name}</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p>{introduction}</p>
            <p className="text-xs leading-6 text-muted">시행일: <time dateTime={SERVICE_POLICIES.effectiveDate}>{SERVICE_POLICIES.effectiveDateLabel}</time></p>
            <PolicyLinks />
          </div>
          {children}
        </article>
      </main>
    </>
  );
}

export function PolicySection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3 scroll-mt-6">
      <h2 id={`${id}-title`} className="text-lg font-bold leading-snug sm:text-xl">{title}</h2>
      {children}
    </section>
  );
}

export function PolicyContact() {
  return (
    <dl className="space-y-2 text-sm">
      <div><dt className="font-semibold">일반 서비스 문의</dt><dd><PolicyEmailLink kind="support" /></dd></div>
      <div><dt className="font-semibold">개인정보 관련 문의 및 권리 행사</dt><dd><PolicyEmailLink /></dd></div>
    </dl>
  );
}

export function PolicyEmailLink({ kind = 'privacy' }: { kind?: 'privacy' | 'support' }) {
  const email = kind === 'support' ? SERVICE_POLICIES.supportEmail : SERVICE_POLICIES.privacyContactEmail;
  return <a href={`mailto:${email}`} className="break-all underline underline-offset-4">{email}</a>;
}
