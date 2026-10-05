'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { OfficialStatistic } from '@/lib/types';
import { chartGeometry, formatStatisticValue, readSeries, statisticUnit } from '@/lib/official-statistics';

export function StatisticTrendChart({ item }: { item: OfficialStatistic }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const tooltipId = useId();
  const summaryId = useId();
  const series = readSeries(item);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (new Set(series.map((point) => point.year)).size < 2) return <p className="text-sm text-muted">{series.length ? `${series.at(-1)!.year}년 ${formatStatisticValue(item, series.at(-1)!.value)} · 추세 비교에는 관측값이 더 필요해요.` : '표시할 추세 데이터가 아직 없어요.'}</p>;

  const { points, ticks, left, right, bottom } = chartGeometry(series, width);
  const selected = active === null ? null : points[active];
  const yearTickStep = Math.max(1, Math.ceil((points.length - 1) / (width < 450 ? 3 : 6)));
  return (
    <figure className="min-w-0 max-w-full" aria-label={`${item.title} 연도별 추세`}>
      <figcaption id={summaryId} className="text-sm leading-6 text-muted">
        {series[0].year}~{series.at(-1)!.year}년 · 단위: {statisticUnit(item) || '원자료 기준'}
        <span className="block text-xs">점을 누르거나 키보드로 이동하면 정확한 값을 볼 수 있어요. 아래 표에서도 확인할 수 있어요.</span>
      </figcaption>
      <div ref={container} className="relative mt-2 min-w-0 max-w-full pt-9">
        {selected ? (
          <div id={tooltipId} role="tooltip" className="pointer-events-none absolute top-0 z-10 max-w-[200px] break-words rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-bold text-ink shadow-sm"
            style={{ left: Math.min(Math.max(selected.x, 100), width - 100), transform: 'translateX(-50%)' }}>
            {selected.year}년 · {formatStatisticValue(item, selected.value)}
          </div>
        ) : null}
        <svg viewBox={`0 0 ${width} 280`} width="100%" height="280" aria-describedby={summaryId} className="block max-w-full overflow-visible">
          {ticks.map((tick, index) => (
            <g key={index} aria-hidden="true">
              <line x1={left} x2={right} y1={tick.y} y2={tick.y} className="stroke-line" strokeDasharray="3 4" />
              <text x={left - 8} y={tick.y + 4} textAnchor="end" fontSize="12" className="fill-muted">{tick.value.toLocaleString('ko-KR', { notation: 'compact', maximumFractionDigits: 2 })}</text>
            </g>
          ))}
          <line x1={left} x2={right} y1={bottom} y2={bottom} className="stroke-line" aria-hidden="true" />
          <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" className="stroke-link" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true" />
          {points.map((point, index) => (
            <g key={`${point.year}_${index}`}>
              {(index % yearTickStep === 0 && points.length - 1 - index >= Math.ceil(yearTickStep / 2) || index === points.length - 1) ? <text x={point.x} y={bottom + 26} textAnchor="middle" fontSize="12" className="fill-muted" aria-hidden="true">{point.year}</text> : null}
              <g tabIndex={0} role="button" aria-label={`${point.year}년 ${formatStatisticValue(item, point.value)}${index === points.length - 1 ? ', 최근 관측' : ''}`}
                aria-describedby={active === index ? tooltipId : undefined}
                onFocus={() => setActive(index)} onBlur={() => setActive(null)}
                onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)}
                onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); } if (event.key === 'Escape') setActive(null); }}
                className="group cursor-pointer outline-none">
                <rect x={point.x - 20} y={point.y - 22} width="40" height="44" fill="transparent" />
                <circle cx={point.x} cy={point.y} r={active === index ? 9 : 8} fill="none" className="stroke-link opacity-0 group-focus-visible:opacity-100" strokeWidth="2" />
                <circle cx={point.x} cy={point.y} r={index === points.length - 1 ? 5.5 : 3.5} className="fill-link stroke-surface" strokeWidth="2" />
              </g>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
