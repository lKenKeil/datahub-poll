import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import type { OfficialStatistic } from '@/lib/types';
import { SiteHeader } from '@/components/site-header';
import { OfficialStatisticDetail } from '@/components/official-statistic-detail';

export default async function OfficialStatisticPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await supabaseServer.from('official_statistics').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('공식 통계를 불러오지 못했어요.');
  if (!data) notFound();
  const item = data as OfficialStatistic;
  const { data: relatedRows } = await supabaseServer.from('official_statistics')
    .select('id,title,category,source_id,source_url,published_at,observed_at,metadata')
    .eq('category', item.category).eq('is_verified', true).neq('id', item.id)
    .order('published_at', { ascending: false, nullsFirst: false }).limit(3);
  return (
    <main className="min-h-screen w-full min-w-0 max-w-full bg-canvas pb-16 text-ink">
      <SiteHeader />
      <OfficialStatisticDetail item={item} related={(relatedRows ?? []) as OfficialStatistic[]} />
    </main>
  );
}
