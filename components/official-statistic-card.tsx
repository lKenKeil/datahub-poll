'use client';

import Link from 'next/link';
import type { OfficialStatistic } from '@/lib/types';
import { buildStatisticSummary, formatStatisticValue, observationLabel, readLatestObservation, readRanking, statisticSource } from '@/lib/official-statistics';

export function OfficialStatisticCard({ item, opened, onToggle }: { item: OfficialStatistic; opened: boolean; onToggle: () => void }) {
  const latest = readLatestObservation(item);
  const ranking = readRanking(item);
  const summaryId = `stat-summary-${item.id}`;
  return (
    <article className="flex min-w-0 flex-col border-t border-line py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-medium text-muted">
        <span>{item.category}</span><span>{observationLabel(item)}</span>
      </div>
      <h3 className="mt-2 break-words text-lg font-bold leading-6 text-ink">{item.title}</h3>
      <div className="mt-3">
        {ranking.length ? <p className="text-lg font-bold text-ink">{ranking[0].rank}위 {ranking[0].country} · {formatStatisticValue(item, ranking[0].value)}</p>
          : latest.value !== null ? <p className="text-2xl font-bold text-ink">{formatStatisticValue(item, latest.value)}</p>
          : <p className="line-clamp-2 text-sm leading-6 text-muted">{item.summary || '원문에서 공식 통계를 살펴보세요.'}</p>}
        <p className="mt-1 text-xs text-muted">출처: {statisticSource(item)}</p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <button type="button" onClick={onToggle} aria-expanded={opened} aria-controls={summaryId} className="min-h-11 rounded-xl border border-line px-3 text-sm font-medium text-ink hover:border-link hover:text-link">{opened ? '요약 접기' : '요약 보기'}</button>
        <Link href={`/stats/${item.id}`} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-link hover:bg-primary-soft">자세히 보기 <span aria-hidden="true" className="ml-2">→</span></Link>
      </div>
      <div id={summaryId} hidden={!opened} className="mt-3 space-y-1.5 border-l-2 border-link/40 pl-3 text-sm leading-6 text-ink">
        <p className="font-bold">요약</p>
        {opened ? buildStatisticSummary(item).map((line, index) => <p key={index}>{line}</p>) : null}
        {opened && latest.value !== null && !ranking.length ? <p className="pt-1 text-xs text-muted">수치는 반올림해 표시하며, 변화는 반올림 전 원자료로 계산해요.</p> : null}
      </div>
    </article>
  );
}
