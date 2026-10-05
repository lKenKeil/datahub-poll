'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export default function DataError({ reset }: { reset: () => void }) {
  return <main className="min-h-screen bg-canvas text-ink"><SiteHeader /><section className="mx-auto max-w-[1280px] space-y-4 px-4 py-8 sm:px-6 lg:px-8" role="alert">
    <h1 className="text-2xl font-bold">공식 통계를 불러오지 못했어요.</h1><p className="text-sm text-muted">잠시 후 다시 시도해주세요.</p>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={reset} className="min-h-11 rounded-xl bg-primary px-4 font-bold text-white">다시 시도</button><Link href="/?category=data" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-bold">데이터 둘러보기</Link></div>
  </section></main>;
}
