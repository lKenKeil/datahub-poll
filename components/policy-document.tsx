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
            <p className="text-sm font-medium text-muted">{BRAND.name} · 공개 전 검토 초안</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p>{introduction}</p>
            <p className="text-xs leading-6 text-muted">시행일: {SERVICE_POLICIES.effectiveDate ?? '정식 공개 전 확정 예정'} · 초안 기준일: {SERVICE_POLICIES.reviewedAt}</p>
            <div role="note" className="border-l-2 border-primary pl-4 text-sm leading-7">
              운영자와 문의 연락처, 정보 보유기간 및 외부 서비스 처리 세부사항을 확인 중입니다. 이 문서는 현재 구현을 설명하는 초안이며, 최종 정책으로 확정되기 전에는 공개 유입 및 OAuth 심사 제출용 완성 문서로 사용하지 않습니다.
            </div>
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
      <div><dt className="font-semibold">운영자</dt><dd>{SERVICE_POLICIES.operatorName ?? '정식 공개 전 확정하여 안내할 예정입니다.'}</dd></div>
      <div><dt className="font-semibold">개인정보 보호 및 서비스 문의</dt><dd>{SERVICE_POLICIES.privacyContactEmail
        ? <a href={`mailto:${SERVICE_POLICIES.privacyContactEmail}`} className="underline underline-offset-4">{SERVICE_POLICIES.privacyContactEmail}</a>
        : '문의 이메일과 담당자를 확인 중입니다. 유효한 문의 경로를 마련한 뒤 정식 정책을 공개합니다.'}</dd></div>
    </dl>
  );
}
