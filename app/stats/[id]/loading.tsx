import { SiteHeader } from '@/components/site-header';

export default function DataLoading() {
  return <main className="min-h-screen bg-canvas text-ink"><SiteHeader /><div role="status" className="mx-auto max-w-[1280px] px-4 py-8 text-sm text-muted sm:px-6 lg:px-8">공식 통계를 불러오는 중...</div></main>;
}
