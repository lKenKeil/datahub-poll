// Deterministic math and rendered component regression tests. No network or DB writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const modules = new Map();
function load(path) {
  if (modules.has(path)) return modules.get(path);
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loadedModule = { exports: {} };
  new Function('module', 'exports', 'require', output)(loadedModule, loadedModule.exports, (name) => {
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name.startsWith('@/lib/official-statistics')) return load('lib/official-statistics.ts');
    if (name.startsWith('@/components/')) return load(`components/${name.split('/').at(-1)}.tsx`);
    return require(name);
  });
  modules.set(path, loadedModule.exports);
  return loadedModule.exports;
}
const helpers = load('lib/official-statistics.ts');
const { readSeries, readLatestObservation, readRanking, formatStatisticValue, formatStatisticChange, buildStatisticSummary, chartGeometry, observationLabel } = helpers;
const { OfficialStatisticCard } = load('components/official-statistic-card.tsx');
const { OfficialStatisticDetail } = load('components/official-statistic-detail.tsx');
const { StatisticTrendChart } = load('components/statistic-trend-chart.tsx');
const item = (values = [6.43, 6.7], extra = {}) => ({
  id: 'stat_test', category: '사회/경제', title: '검증용 지표', source_id: 'world_bank', source_url: 'https://example.com/source',
  methodology: 'Methodology only', confidence_note: 'Metadata only', published_at: '2025-12-31',
  metadata: { indicator_id: 'SL.UEM.TOTL.ZS', latest_year: '2025', latest_value: values.at(-1), series: values.map((value, index) => ({ year: String(2026 - values.length + index), value })), ...extra },
});
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('series rejects missing/null/blank/boolean/non-finite values; preserves real zero and input', () => {
  const stat = item([], { series: [{ year: '2020', value: null }, { year: '2021', value: '' }, { year: '2022', value: false }, { year: 'bad', value: 1 }, { year: '2024', value: Infinity }, { year: '2023', value: 0 }] });
  const before = structuredClone(stat);
  assert.deepEqual(readSeries(stat), [{ year: '2023', value: 0 }]);
  assert.deepEqual(stat, before);
});
test('latest year/value stay paired, absent metadata uses series without inventing a year', () => {
  assert.deepEqual(readLatestObservation(item([1, 2])), { year: '2025', value: 2 });
  assert.deepEqual(readLatestObservation(item([1], { latest_year: '2026', latest_value: null })), { year: '2026', value: null });
  assert.deepEqual(readLatestObservation(item([1], { latest_year: null, latest_value: null })), { year: '2025', value: 1 });
});
test('all existing percentage indicators use percentage points, never percent change', () => {
  for (const indicator of ['SL.UEM.TOTL.ZS', 'SL.UEM.1524.ZS', 'FP.CPI.TOTL.ZG', 'NY.GDP.MKTP.KD.ZG', 'GB.XPD.RSDV.GD.ZS', 'SE.XPD.TOTL.GD.ZS', 'IT.NET.USER.ZS', 'NE.TRD.GNFS.ZS', 'SP.POP.65UP.TO.ZS', 'SE.TER.ENRR', 'EG.ELC.ACCS.ZS']) {
    const stat = item([6.43, 6.7], { indicator_id: indicator });
    assert.equal(formatStatisticValue(stat, 6.7), '6.70%');
    assert.equal(formatStatisticChange(stat, 0.27), '0.27%p');
    assert.match(buildStatisticSummary(stat).join(' '), /전년보다 0.27%p 상승/);
  }
});
test('counts, per-100, currency, age and supplied units retain their units', () => {
  const cases = [['SP.POP.TOTL', '1,234 명'], ['IT.CEL.SETS.P2', '1,234.00 / 100명'], ['NY.GDP.PCAP.CD', '1,234.00 미달러'], ['SP.DYN.LE00.IN', '1,234.00세']];
  for (const [indicator_id, expected] of cases) assert.equal(formatStatisticValue(item([1234], { indicator_id }), 1234), expected);
  assert.equal(formatStatisticChange(item([1, 3], { indicator_id: 'custom', unit: '건' }), 2), '2.00 건');
  assert.match(formatStatisticChange(item(), 0.0001), /미만/);
});
test('non-adjacent observation is not called last year; mismatch does not invent comparisons', () => {
  const stat = item([3, 4], { series: [{ year: '2020', value: 3 }, { year: '2025', value: 4 }] });
  assert.match(buildStatisticSummary(stat).join(' '), /이전 관측 2020년/);
  assert.doesNotMatch(buildStatisticSummary(stat).join(' '), /전년/);
  assert.doesNotMatch(buildStatisticSummary(item([1, 2], { latest_value: 9 })).join(' '), /전년/);
});
test('trend is conservative: monotonic rise/fall, flat, and large zigzag are distinct', () => {
  assert.match(buildStatisticSummary(item([1, 2, 3, 4, 5])).join(' '), /전반적으로 상승/);
  assert.match(buildStatisticSummary(item([5, 4, 3, 2, 1])).join(' '), /전반적으로 하락/);
  assert.match(buildStatisticSummary(item([5, 5, 5])).join(' '), /같은 수준을 유지/);
  assert.match(buildStatisticSummary(item([1, 100, 2, 99, 3])).join(' '), /상승·하락을 반복/);
  assert.match(buildStatisticSummary(item([6.5, 6.6, 6.5, 6.6, 6.5])).join(' '), /비슷한 수준에서 등락/);
  assert.match(buildStatisticSummary(item([1])).join(' '), /관측치가 부족/);
  assert.doesNotMatch(buildStatisticSummary(item([1, 2, 3])).join(' '), /정책|원인|때문/);
});
test('ranking summary uses the provided countries, no synthetic series or national aggregate', () => {
  const stat = item([], { latest_value: null, ranking_top10: [{ rank: 2, country: 'B', value: 97 }, { rank: 1, country: 'A', value: 98 }] });
  assert.equal(readRanking(stat)[0].country, 'A');
  assert.match(buildStatisticSummary(stat)[0], /제공된 2개국.*A.*98.00%.*1위/);
  const html = render(OfficialStatisticDetail, { item: stat, related: [] });
  assert.match(html, /제공된 국가별 순위/);
  assert.doesNotMatch(html, /polyline|연도별 데이터/);
});
test('chart coordinates are finite and year gaps proportional, including flat/zero/negative values', () => {
  for (const values of [[0, 0], [-5, -1], [6.43, 6.7]]) {
    const series = readSeries(item(values));
    const geometry = chartGeometry(series, 280);
    for (const point of geometry.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
  const g = chartGeometry([{ year: '2020', value: 1 }, { year: '2021', value: 2 }, { year: '2025', value: 3 }], 640);
  assert.ok(Math.abs((g.points[1].x - g.points[0].x) / (g.points[2].x - g.points[0].x) - 0.2) < 0.0001);
});
test('multiple observations render line and keyboard points; empty/single do not render a line', () => {
  const html = render(StatisticTrendChart, { item: item() });
  assert.match(html, /polyline/);
  assert.equal((html.match(/role="button"/g) ?? []).length, 2);
  assert.match(html, /2025년 6.70%/);
  assert.doesNotMatch(render(StatisticTrendChart, { item: item([1]) }), /<svg/);
  assert.match(render(StatisticTrendChart, { item: item([]) }), /표시할 추세 데이터가 아직 없어요/);
  assert.doesNotMatch(render(StatisticTrendChart, { item: item([1, 2], { series: [{ year: '2025', value: 1 }, { year: '2025', value: 2 }] }) }), /<svg/);
});
test('expanded card contains computed summary, not methodology; detail retains table/source', () => {
  const stat = item();
  const card = render(OfficialStatisticCard, { item: stat, opened: true, onToggle() {} });
  assert.match(card, /aria-expanded="true"/);
  assert.match(card, /0.27%p/);
  assert.doesNotMatch(card, /Methodology only|Metadata only/);
  const detail = render(OfficialStatisticDetail, { item: stat, related: [item([1])] });
  assert.match(detail, /<table/);
  assert.match(detail, /scope="row"/);
  assert.match(detail, /출처·방법론/);
  assert.match(detail, /Methodology only|Metadata only/);
  assert.match(detail, /연관 통계/);
  assert.equal(observationLabel(stat), '최신 관측 2025년');
  assert.doesNotMatch(detail, /2025-12-31/);
});
test('data landing excludes poll UI without editing discovery/ranking algorithms', () => {
  const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /activeCategory === '데이터' \|\| activeCategory === '전체'/);
  assert.match(source, /activeCategory !== '데이터' \? <section id="latest-polls"/);
  assert.match(source, /activeCategory !== '데이터' && \(loading \|\| popularPolls.length/);
  assert.match(source, /activeCategory !== '데이터' && \(loading \|\| risingPolls.length/);
  assert.match(source, /<SiteHeader searchTerm=/);
  assert.match(source, /statsError \? \(/);
});
