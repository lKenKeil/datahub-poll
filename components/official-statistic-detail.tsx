import Link from 'next/link';
import type { OfficialStatistic } from '@/lib/types';
import { buildStatisticSummary, formatStatisticChange, formatStatisticValue, metadataString, observationLabel, previousObservation, readLatestObservation, readRanking, readSeries, statisticSource } from '@/lib/official-statistics';
import { StatisticTrendChart } from '@/components/statistic-trend-chart';

export function OfficialStatisticDetail({ item, related }: { item: OfficialStatistic; related: OfficialStatistic[] }) {
  const latest = readLatestObservation(item);
  const series = readSeries(item);
  const ranking = readRanking(item);
  const previous = previousObservation(item);
  const delta = previous && latest.value !== null ? latest.value - previous.value : null;
  const comparison = previous && Number(latest.year) - Number(previous.year) === 1 ? '전년 대비' : previous ? `${previous.year}년 관측 대비` : '';
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1280px] space-y-8 px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <Link href="/?category=data" className="inline-flex min-h-11 items-center text-sm font-bold text-link">← 공식 데이터 둘러보기</Link>
      <header className="min-w-0 rounded-3xl border border-line bg-hero p-5 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-muted">
          <span>{item.category} · {statisticSource(item)}</span><span>{observationLabel(item)}</span>
        </div>
        <h1 className="mt-3 max-w-4xl break-words text-2xl font-bold leading-tight tracking-tight sm:text-3xl md:text-4xl">{item.title}</h1>
        {latest.value !== null && !ranking.length ? (
          <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div><p className="text-xs font-medium text-muted">최신 관측값</p><p className="mt-1 break-words text-3xl font-bold text-ink sm:text-4xl">{formatStatisticValue(item, latest.value)}</p></div>
            {delta !== null ? <p className="pb-1 text-sm font-medium text-muted">{comparison} {delta === 0 ? '변화 없음' : `${formatStatisticChange(item, delta)} ${delta > 0 ? '상승' : '하락'}`}</p> : null}
          </div>
        ) : null}
        <div className="mt-5 max-w-3xl space-y-1.5 border-t border-line pt-4 text-sm leading-6 text-muted" aria-label="데이터 요약">
          <h2 className="font-bold text-ink">요약</h2>
          {buildStatisticSummary(item).map((line, index) => <p key={index}>{line}</p>)}
          {delta !== null ? <p className="pt-1 text-xs">수치는 반올림해 표시하며, 변화는 반올림 전 원자료로 계산해요.</p> : null}
        </div>
      </header>
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <section aria-labelledby="trend-heading" className="min-w-0 rounded-3xl border border-line bg-surface p-4 sm:p-6">
          <h2 id="trend-heading" className="mb-3 text-lg font-bold">{ranking.length ? '제공된 국가별 순위' : '최근 추세'}</h2>
          {ranking.length ? <ol className="divide-y divide-line">
            {ranking.map((row, index) => <li key={`${row.rank}_${row.iso3 ?? row.country}_${index}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
              <span className="w-8 shrink-0 font-bold text-link">{row.rank}위</span><span className="min-w-0 flex-1 break-words font-medium">{row.country}</span><span className="font-bold tabular-nums">{formatStatisticValue(item, row.value)}</span>
            </li>)}
          </ol> : <StatisticTrendChart item={item} />}
        </section>
        <section aria-labelledby="related-heading" className="min-w-0">
          <h2 id="related-heading" className="mb-3 text-lg font-bold">연관 통계</h2>
          {related.length ? <div className="divide-y divide-line border-y border-line">
            {related.map((row) => {
              const observation = readLatestObservation(row);
              return <Link key={row.id} href={`/stats/${row.id}`} className="group block min-w-0 rounded-lg py-4 transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-link">
                <p className="text-xs text-muted">{observationLabel(row)}</p><p className="mt-1.5 break-words text-base font-bold leading-6 group-hover:text-link">{row.title}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-sm"><span className="font-medium text-muted">{observation.value !== null ? formatStatisticValue(row, observation.value) : statisticSource(row)}</span><span aria-hidden="true" className="shrink-0 text-link">→</span></div>
              </Link>;
            })}
          </div> : <p className="text-sm text-muted">연결된 연관 통계가 아직 없어요.</p>}
        </section>
      </div>
      {ranking.length === 0 ? <section aria-labelledby="year-table-heading" className="min-w-0 space-y-4 border-t border-line pt-6">
        <h2 id="year-table-heading" className="text-lg font-bold">연도별 데이터</h2>
        {series.length ? <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">{item.title} 연도별 정확한 관측값</caption>
          <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="w-1/3 py-3 font-medium">관측 연도</th><th scope="col" className="py-3 text-right font-medium">값</th></tr></thead>
          <tbody className="divide-y divide-line">{[...series].reverse().map((point, index) => <tr key={`${point.year}_${index}`}><th scope="row" className="py-3 font-medium">{point.year}년</th><td className="break-words py-3 text-right font-bold tabular-nums">{formatStatisticValue(item, point.value)}</td></tr>)}</tbody>
        </table> : <p className="text-sm text-muted">연도별 원자료가 아직 연결되지 않았어요.</p>}
      </section> : null}
      <section id="source-methodology" aria-labelledby="source-heading" className="min-w-0 space-y-4 border-t border-line pt-6">
        <h2 id="source-heading" className="text-lg font-bold">출처·방법론</h2>
        <dl className="max-w-4xl space-y-3 text-sm leading-6">
          <div><dt className="font-bold">출처</dt><dd className="break-words text-muted">{statisticSource(item)}</dd></div>
          {metadataString(item, 'indicator_id') ? <div><dt className="font-bold">지표 ID</dt><dd className="break-all text-muted">{metadataString(item, 'indicator_id')}</dd></div> : null}
          <div><dt className="font-bold">관측 시점</dt><dd className="text-muted">{observationLabel(item)}</dd></div>
          {item.methodology ? <div><dt className="font-bold">방법론 / 데이터셋</dt><dd className="break-words text-muted">{item.methodology}</dd></div> : null}
          {item.sample_size != null ? <div><dt className="font-bold">표본수</dt><dd className="text-muted">{item.sample_size.toLocaleString('ko-KR')}</dd></div> : null}
          {item.confidence_note ? <div><dt className="font-bold">해석 참고</dt><dd className="break-words text-muted">{item.confidence_note}</dd></div> : null}
        </dl>
        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-bold text-link hover:bg-primary-soft">공식 원문 보기 <span className="ml-2" aria-hidden="true">↗</span></a>
      </section>
    </div>
  );
}
