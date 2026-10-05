import type { OfficialStatistic } from './types';

export type YearPoint = { year: string; value: number };
export type RankingPoint = { rank: number; country: string; iso3?: string; value: number };

const PERCENT_INDICATORS = new Set([
  'IT.NET.USER.ZS', 'SL.UEM.1524.ZS', 'SL.UEM.TOTL.ZS', 'FP.CPI.TOTL.ZG',
  'GB.XPD.RSDV.GD.ZS', 'SE.XPD.TOTL.GD.ZS', 'NY.GDP.MKTP.KD.ZG',
  'NE.TRD.GNFS.ZS', 'SP.POP.65UP.TO.ZS', 'EG.ELC.ACCS.ZS', 'SE.TER.ENRR',
]);

export function metadataString(item: OfficialStatistic, key: string) {
  const value = item.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readSeries(item: OfficialStatistic): YearPoint[] {
  const raw = item.metadata?.series;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((point) => {
    if (!point || typeof point !== 'object') return [];
    const year = String(point.year ?? '');
    const value = finiteNumber(point.value);
    return /^\d{4}$/.test(year) && value !== null ? [{ year, value }] : [];
  }).sort((a, b) => Number(a.year) - Number(b.year));
}

export function readRanking(item: OfficialStatistic): RankingPoint[] {
  const raw = item.metadata?.ranking_top10;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((point) => {
    if (!point || typeof point !== 'object') return [];
    const rank = finiteNumber(point.rank);
    const value = finiteNumber(point.value);
    const country = typeof point.country === 'string' ? point.country.trim() : '';
    if (rank === null || !Number.isInteger(rank) || rank < 1 || value === null || !country) return [];
    return [{ rank, value, country, ...(typeof point.iso3 === 'string' ? { iso3: point.iso3 } : {}) }];
  }).sort((a, b) => a.rank - b.rank || a.country.localeCompare(b.country, 'ko'));
}

export function readLatestObservation(item: OfficialStatistic) {
  const series = readSeries(item);
  const last = series.at(-1);
  const rawYear = item.metadata?.latest_year;
  const year = /^\d{4}$/.test(String(rawYear ?? '')) ? String(rawYear) : null;
  const value = finiteNumber(item.metadata?.latest_value);
  // Do not attach an older series value to a newer metadata year, or vice versa.
  if (year || value !== null) return { year, value };
  return { year: last?.year ?? null, value: last?.value ?? null };
}

// Units mirror the existing collector. Unknown indicators retain their supplied
// unit; no numeric data, observation year or source is rewritten.
export function statisticUnit(item: OfficialStatistic) {
  const indicator = metadataString(item, 'indicator_id') ?? '';
  if (PERCENT_INDICATORS.has(indicator)) return '%';
  const units: Record<string, string> = {
    'SP.POP.TOTL': '명', 'IT.CEL.SETS.P2': '/ 100명', 'IT.NET.BBND.P2': '/ 100명',
    'NY.GDP.PCAP.CD': '미달러', 'SP.DYN.LE00.IN': '세', 'EN.ATM.PM25.MC.M3': 'µg/m³',
    'SP.DYN.TFRT.IN': '명', 'IT.NET.SECR.P6': '/ 100만명', 'SH.DYN.NMRT': '/ 1,000',
    'IP.JRN.ARTC.SC': '편',
  };
  return units[indicator] ?? metadataString(item, 'unit') ?? '';
}

export function formatStatisticValue(item: OfficialStatistic, value: number) {
  const unit = statisticUnit(item);
  const count = ['SP.POP.TOTL', 'IP.JRN.ARTC.SC'].includes(metadataString(item, 'indicator_id') ?? '');
  const number = count ? Math.round(value).toLocaleString('ko-KR') : value.toLocaleString('ko-KR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${number}${unit === '%' || unit === '세' || unit === '편' ? '' : unit ? ' ' : ''}${unit}`;
}

export function formatStatisticChange(item: OfficialStatistic, delta: number) {
  const unit = statisticUnit(item);
  const abs = Math.abs(delta);
  const value = abs > 0 && abs < 0.005 ? '0.01 미만' : abs.toLocaleString('ko-KR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${value}${unit === '%' ? '%p' : unit ? ` ${unit}` : ''}`;
}

export function observationLabel(item: OfficialStatistic) {
  const { year } = readLatestObservation(item);
  if (year) return `최신 관측 ${year}년`;
  // A date without annual metadata is not relabelled as a publication year.
  if (item.observed_at) return `관측일 ${item.observed_at}`;
  if (item.published_at) return `공개일 ${item.published_at}`;
  return '관측 시점 미제공';
}

export function statisticSource(item: OfficialStatistic) {
  return ({ world_bank: 'World Bank', kosis: 'KOSIS', oecd: 'OECD', cloudflare_radar: 'Cloudflare Radar' } as Record<string, string>)[item.source_id] ?? item.source_id;
}

export function previousObservation(item: OfficialStatistic) {
  const latest = readLatestObservation(item);
  const series = readSeries(item);
  const index = series.findLastIndex((point) => point.year === latest.year && point.value === latest.value);
  return index > 0 ? series[index - 1] : null;
}

export function buildStatisticSummary(item: OfficialStatistic): string[] {
  const ranking = readRanking(item);
  const latest = readLatestObservation(item);
  if (ranking.length) {
    const first = ranking[0];
    return [
      `${latest.year ? `${latest.year}년 ` : ''}제공된 ${ranking.length}개국 순위에서 ${first.country}의 값은 ${formatStatisticValue(item, first.value)}이며 ${first.rank}위예요.`,
      '각 국가의 값과 순위는 자세히 보기에서 비교할 수 있어요.',
    ];
  }
  if (latest.value === null) return [item.summary?.trim() || '요약에 필요한 관측값이 아직 없어요. 원문 출처에서 확인해주세요.'];
  const lines = [`${latest.year ? `${latest.year}년 ` : ''}최신 관측값은 ${formatStatisticValue(item, latest.value)}예요.`];
  const previous = previousObservation(item);
  if (previous) {
    const delta = latest.value - previous.value;
    const comparison = Number(latest.year) - Number(previous.year) === 1 ? '전년' : `이전 관측 ${previous.year}년`;
    lines.push(delta === 0 ? `${comparison}과 같은 값이에요.` : `${comparison}보다 ${formatStatisticChange(item, delta)} ${delta > 0 ? '상승' : '하락'}했어요.`);
  }
  const series = readSeries(item);
  const last = series.at(-1);
  if (last?.year !== latest.year || last.value !== latest.value || series.length < 3) {
    lines.push('최근 흐름을 비교하기에는 관측치가 부족해요.');
    return lines;
  }
  const recent = series.slice(-5);
  const changes = recent.slice(1).map((point, index) => point.value - recent[index].value);
  const net = recent.at(-1)!.value - recent[0].value;
  const sameDirection = changes.filter((delta) => net > 0 ? delta > 0 : delta < 0).length;
  const range = Math.max(...recent.map((p) => p.value)) - Math.min(...recent.map((p) => p.value));
  const sustained = net !== 0 && sameDirection / changes.length >= 0.75 && Math.abs(net) >= range * 0.5;
  const smallRange = range <= Math.max(Math.abs(latest.value) * 0.05, 0.005);
  const trend = range === 0 ? '같은 수준을 유지' : sustained ? `전반적으로 ${net > 0 ? '상승' : '하락'}` : smallRange ? '비슷한 수준에서 등락' : '상승·하락을 반복';
  lines.push(`최근 ${recent.length}개 관측치(${recent[0].year}~${recent.at(-1)!.year}년)는 ${trend}했어요.`);
  return lines;
}

export function chartGeometry(series: readonly YearPoint[], width: number, height = 280) {
  const left = 64, right = width - 24, top = 24, bottom = height - 40;
  const values = series.map((point) => point.value);
  const min = Math.min(...values), max = Math.max(...values);
  const padding = (max - min || Math.abs(max) * 0.1 || 1) * 0.15;
  const low = min - padding, high = max + padding;
  const start = Number(series[0].year), end = Number(series.at(-1)!.year);
  const points = series.map((point) => ({ ...point,
    x: left + (Number(point.year) - start) / (end - start || 1) * (right - left),
    y: bottom - (point.value - low) / (high - low) * (bottom - top),
  }));
  const ticks = Array.from({ length: 4 }, (_, i) => ({
    value: high - (high - low) * i / 3,
    y: top + (bottom - top) * i / 3,
  }));
  return { points, ticks, left, right, bottom };
}
