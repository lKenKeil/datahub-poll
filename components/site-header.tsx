'use client';

import Link from 'next/link';
import { BrandHomeLink } from '@/components/brand-home-link';
import { AuthButton } from '@/components/auth-button';
import { ThemeToggle } from '@/components/theme-toggle';

// Same header on the home and official-data pages. With no controlled search,
// a normal GET form hands the query back to the existing home filter.
export function SiteHeader({ searchTerm, onSearchChange }: {
  searchTerm?: string;
  onSearchChange?: (value: string) => void;
}) {
  const search = (mobile: boolean) => (
    <form action="/" role="search" onSubmit={onSearchChange ? (event) => event.preventDefault() : undefined} className={mobile ? 'w-full min-w-0 max-w-full px-4 pb-3 md:hidden' : 'relative ml-auto hidden min-w-0 w-full max-w-xl md:block'}>
      <label className="relative block min-w-0 max-w-full">
        <span className="sr-only">질문과 데이터 검색</span>
        <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">⌕</span>
        <input type="search" name="q" value={searchTerm} onChange={onSearchChange ? (event) => onSearchChange(event.target.value) : undefined}
          className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-line bg-surface-muted py-2.5 pl-10 pr-4 text-sm font-medium outline-none transition focus:border-link focus:ring-2 focus:ring-link/20"
          placeholder={mobile ? '질문·데이터 검색' : '궁금한 질문과 데이터를 찾아보세요'} />
      </label>
    </form>
  );
  return (
    <nav aria-label="사이트 메뉴" className="sticky top-0 z-50 w-full min-w-0 max-w-full border-b border-line bg-canvas/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full min-w-0 max-w-[1440px] items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8">
        <BrandHomeLink showDescriptor />
        {search(false)}
        <Link href="/create" className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-3 text-sm font-bold text-white transition-colors hover:bg-primary-hover md:ml-0 sm:px-4">
          <span className="sm:hidden">+ 질문</span><span className="hidden sm:inline">+ 질문 올리기</span>
        </Link>
        <AuthButton /><ThemeToggle />
      </div>
      {search(true)}
    </nav>
  );
}
