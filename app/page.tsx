'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { POLLS } from '../data/polls';
import { DbPoll, OfficialStatistic, PollCategory } from '../lib/types';
import { supabase } from '../lib/supabase';

const categories: Array<'전체' | PollCategory> = [
  '전체',
  '학술/통계',
  'IT/테크',
  '사회/경제',
  '라이프스타일',
  '커뮤니티',
];

function getReliability(participants: number) {
  if (participants >= 1000) {
    return { label: '신뢰도 높음', style: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
  }

  if (participants >= 300) {
    return { label: '신뢰도 보통', style: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
  }

  return { label: '신뢰도 낮음', style: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
}

function getTrendingScore(poll: DbPoll) {
  const participants = poll.participants ?? 0;
  const created = poll.created_at ? new Date(poll.created_at) : null;

  if (!created || Number.isNaN(created.getTime())) {
    return participants;
  }

  const ageHours = Math.max(0, (Date.now() - created.getTime()) / (1000 * 60 * 60));
  const freshnessBoost = Math.max(0, 36 - ageHours) * 8;
  return participants + freshnessBoost;
}

function readLatestValue(stat: OfficialStatistic) {
  const raw = (stat.metadata as Record<string, unknown> | null | undefined)?.latest_value;
  return typeof raw === 'number' ? raw : null;
}

function readLatestYear(stat: OfficialStatistic) {
  const raw = (stat.metadata as Record<string, unknown> | null | undefined)?.latest_year;
  return typeof raw === 'string' ? raw : null;
}

function formatStatValue(stat: OfficialStatistic, value: number) {
  const indicatorId = (stat.metadata as Record<string, unknown> | null | undefined)?.indicator_id;
  if (indicatorId === 'SP.POP.TOTL') return `${Math.round(value).toLocaleString()} 명`;
  if (indicatorId === 'IT.NET.USER.ZS' || indicatorId === 'SL.UEM.1524.ZS') return `${value.toFixed(2)}%`;
  if (indicatorId === 'IT.CEL.SETS.P2' || indicatorId === 'IT.NET.BBND.P2') return `${value.toFixed(2)} / 100명`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

export default function Home() {
  const [dbPolls, setDbPolls] = useState<DbPoll[]>([]);
  const [officialStats, setOfficialStats] = useState<OfficialStatistic[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<'전체' | PollCategory>('전체');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [openStatId, setOpenStatId] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const officialIdSet = useMemo(() => new Set(POLLS.map((poll) => poll.id)), []);

  const trendingPolls = useMemo(() => {
    return [...dbPolls]
      .sort((a, b) => getTrendingScore(b) - getTrendingScore(a))
      .slice(0, 3);
  }, [dbPolls]);

  const filteredOfficialStats = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();
    return officialStats.filter((stat) => {
      const matchCategory = activeCategory === '전체' || stat.category === activeCategory;
      const haystack = `${stat.title} ${stat.summary ?? ''} ${(stat.tags ?? []).join(' ')}`.toLowerCase();
      const matchSearch = !normalizedSearch || haystack.includes(normalizedSearch);
      return matchCategory && matchSearch;
    });
  }, [officialStats, activeCategory, searchTerm]);

  const itTechStats = useMemo(() => {
    return officialStats.filter((stat) => stat.category === 'IT/테크');
  }, [officialStats]);

  const fetchPolls = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);

    try {
      const response = await fetch('/api/polls', { cache: 'no-store' });
      const json = (await response.json()) as { data?: DbPoll[]; error?: string };

      if (!response.ok) {
        console.error('데이터 로딩 실패:', json.error ?? 'unknown error');
        if (!silent) setDbPolls([]);
        return;
      }

      const rows = (json.data ?? []).filter((poll) => {
        return poll.id.startsWith('custom_') || !officialIdSet.has(poll.id.replace('official_', ''));
      });

      setDbPolls(rows);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [officialIdSet]);

  const fetchOfficialStats = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setStatsLoading(true);

    try {
      const response = await fetch('/api/official-statistics', { cache: 'no-store' });
      const json = (await response.json()) as { data?: OfficialStatistic[]; error?: string };

      if (!response.ok) {
        console.error('공식 통계 로딩 실패:', json.error ?? 'unknown error');
        if (!silent) setOfficialStats([]);
        return;
      }

      setOfficialStats(json.data ?? []);
    } finally {
      if (!silent) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPolls();
  }, [fetchPolls]);

  useEffect(() => {
    void fetchOfficialStats();
  }, [fetchOfficialStats]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void fetchPolls({ silent: true });
      }, 350);
    };

    const channel = supabase
      .channel('home-polls-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, scheduleRefresh)
      .subscribe();

    const interval = setInterval(() => {
      void fetchPolls({ silent: true });
    }, 20000);

    return () => {
      clearInterval(interval);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [fetchPolls]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
      statsRefreshTimerRef.current = setTimeout(() => {
        void fetchOfficialStats({ silent: true });
      }, 350);
    };

    const channel = supabase
      .channel('home-official-stats-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'official_statistics' }, scheduleRefresh)
      .subscribe();

    const interval = setInterval(() => {
      void fetchOfficialStats({ silent: true });
    }, 30000);

    return () => {
      clearInterval(interval);
      if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [fetchOfficialStats]);

  const filterFn = (poll: { title: string; category?: string }) => {
    const normalizedTitle = poll.title?.toLowerCase() ?? '';
    const matchSearch = normalizedTitle.includes(searchTerm.toLowerCase());
    const matchCategory = activeCategory === '전체' || poll.category === activeCategory;
    return matchSearch && matchCategory;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 font-sans selection:bg-blue-500/30">
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-xl border-b border-slate-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-black tracking-tighter flex items-center gap-2 text-slate-900 dark:text-white">
            <span className="bg-blue-600 px-2 py-0.5 rounded text-white">DATA</span>
            <span className="text-slate-900 dark:text-white">HUB.</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/create"
              className="px-5 py-2 bg-slate-900 text-white dark:bg-white dark:text-black text-sm font-bold rounded-full hover:bg-blue-500 hover:text-white transition-all"
            >
              + 새 데이터 등록
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-16 space-y-24">
        <section className="space-y-10 text-center">
          <div className="space-y-6">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] text-slate-900 dark:text-white">
              세상의 모든 기준을
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-indigo-400 to-emerald-400">
                데이터로 아카이빙하다
              </span>
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-xl font-medium max-w-3xl mx-auto break-keep">
              학술적 가치가 있는 공공 통계부터 뜨거운 커뮤니티 이슈까지,
              <br />
              객관적인 수치로 증명된 실시간 데이터 통합 플랫폼입니다.
            </p>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <a
                href="#official-intel-feed"
                className="px-5 py-2.5 rounded-full bg-cyan-600 text-white text-sm font-black hover:bg-cyan-500 transition-colors"
              >
                통계 먼저 보기
              </a>
              <a
                href="#live-discussions"
                className="px-5 py-2.5 rounded-full border border-slate-300 dark:border-white/15 text-sm font-black hover:border-blue-500/60 transition-colors"
              >
                논제 바로 참여
              </a>
            </div>
          </div>

          <div className="max-w-3xl mx-auto space-y-8">
            <div className="relative group">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-8 py-6 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-3xl text-xl font-bold placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-2xl"
                placeholder="관심 있는 통계나 이슈를 검색하세요..."
              />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-6 py-2 rounded-full text-xs font-black tracking-wider uppercase transition-all ${
                    activeCategory === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200 dark:bg-white/5 dark:border-white/5 dark:hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="official-intel-feed" className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-fuchsia-400 font-black tracking-widest text-xs">TRENDING 24H</span>
            <div className="h-px flex-1 bg-fuchsia-500/20"></div>
          </div>

          {loading ? (
            <div className="text-slate-500 text-sm font-bold">급상승 데이터를 계산하는 중...</div>
          ) : trendingPolls.length === 0 ? (
            <div className="text-slate-500 text-sm font-bold">아직 급상승에 표시할 커뮤니티 투표가 없습니다.</div>
          ) : (
            <div className="grid md:grid-cols-3 gap-6">
              {trendingPolls.map((poll, index) => {
                const reliability = getReliability(poll.participants || 0);
                return (
                  <Link
                    key={poll.id}
                    href={`/vote/${poll.id}`}
                    className="group p-6 rounded-[1.8rem] border border-fuchsia-400/30 bg-gradient-to-b from-fuchsia-500/10 to-transparent hover:border-fuchsia-300 transition-all"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-fuchsia-300 font-black">#{index + 1} HOT</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug group-hover:text-fuchsia-500 dark:group-hover:text-fuchsia-200">{poll.title}</h3>
                      <div className="text-xs text-slate-600 dark:text-slate-300 flex justify-between">
                        <span>{poll.category}</span>
                        <span>N={poll.participants.toLocaleString()}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section id="live-discussions" className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-blue-500 font-black tracking-widest text-xs">OFFICIAL ARCHIVE</span>
            <div className="h-px flex-1 bg-blue-500/20"></div>
          </div>
          {POLLS.filter(filterFn).length === 0 ? (
            <div className="rounded-3xl border border-slate-200 dark:border-white/10 p-8 text-sm text-slate-500">
              선택한 조건에 맞는 오피셜 아카이브가 없습니다. 카테고리나 검색어를 바꿔보세요.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-2 gap-6">
              {POLLS.filter(filterFn).map((p) => {
                const reliability = getReliability(p.participants);
                return (
                  <Link
                    href={`/vote/${p.id}`}
                    key={p.id}
                    className="group flex bg-gradient-to-br from-white to-slate-100 dark:from-slate-900 dark:to-[#020617] border border-blue-500/20 p-8 rounded-[2rem] hover:border-blue-500 transition-all"
                  >
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-black rounded">VERIFIED</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
                      </div>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">{p.title}</h3>
                      <p className="text-slate-600 dark:text-slate-500 text-sm">신뢰할 수 있는 소스로부터 수집된 공인 데이터입니다.</p>
                    </div>
                    <div className="flex flex-col justify-end text-right">
                      <span className="text-2xl font-black text-slate-900 dark:text-white">N={p.participants.toLocaleString()}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-cyan-500 font-black tracking-widest text-xs">OFFICIAL INTEL FEED</span>
            <div className="h-px flex-1 bg-cyan-500/20"></div>
          </div>

          {statsLoading ? (
            <div className="text-slate-500 text-sm font-bold">공식 통계를 불러오는 중...</div>
          ) : filteredOfficialStats.length === 0 ? (
            <div className="text-slate-500 text-sm font-bold">등록된 공식 통계가 없습니다. 마이그레이션/수집 스크립트를 실행해 주세요.</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {filteredOfficialStats.map((item) => {
                const latestValue = readLatestValue(item);
                const latestYear = readLatestYear(item);
                const opened = openStatId === item.id;

                return (
                <article
                  key={item.id}
                  className="group p-6 rounded-3xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:border-cyan-500/50 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400 font-black uppercase">
                        {item.category}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {item.published_at ?? item.observed_at ?? 'date n/a'}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug group-hover:text-cyan-400">
                      {item.title}
                    </h3>
                    {latestValue !== null ? (
                      <div className="inline-flex items-end gap-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25 px-3 py-2">
                        <span className="text-cyan-600 dark:text-cyan-300 text-xl font-black">
                          {formatStatValue(item, latestValue)}
                        </span>
                        <span className="text-[11px] text-cyan-700/80 dark:text-cyan-200/80 font-bold">
                          {latestYear ? `(${latestYear})` : ''}
                        </span>
                      </div>
                    ) : null}
                    {item.summary ? (
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {item.summary}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setOpenStatId(opened ? null : item.id)}
                        className="px-3 py-1.5 text-xs rounded-full border border-slate-300 dark:border-white/20 hover:border-cyan-500/50"
                      >
                        {opened ? '접기' : '인사이트 보기'}
                      </button>
                      <Link
                        href={`/stats/${item.id}`}
                        className="px-3 py-1.5 text-xs rounded-full bg-indigo-600 text-white hover:bg-indigo-500"
                      >
                        통계 보기
                      </Link>
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 text-xs rounded-full bg-cyan-600 text-white hover:bg-cyan-500"
                      >
                        원문 출처
                      </a>
                    </div>
                    {opened ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] p-4 space-y-2">
                        {item.methodology ? (
                          <p className="text-xs text-slate-700 dark:text-slate-300"><span className="font-black">방법론:</span> {item.methodology}</p>
                        ) : null}
                        {item.sample_size ? (
                          <p className="text-xs text-slate-700 dark:text-slate-300"><span className="font-black">표본수:</span> {item.sample_size.toLocaleString()}</p>
                        ) : null}
                        {item.confidence_note ? (
                          <p className="text-xs text-slate-700 dark:text-slate-300"><span className="font-black">신뢰 참고:</span> {item.confidence_note}</p>
                        ) : null}
                        {(item.tags ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {(item.tags ?? []).map((tag) => (
                              <span key={`${item.id}_${tag}`} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              )})}
            </div>
          )}
        </section>

        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-indigo-500 font-black tracking-widest text-xs">IT/TECH SNAPSHOT</span>
            <div className="h-px flex-1 bg-indigo-500/20"></div>
          </div>
          {itTechStats.length === 0 ? (
            <div className="text-slate-500 text-sm font-bold">IT/테크 통계를 수집하면 여기에 핵심 지표가 자동으로 정리됩니다.</div>
          ) : (
            <div className="grid md:grid-cols-3 gap-5">
              {itTechStats.slice(0, 3).map((item) => {
                const latestValue = readLatestValue(item);
                return (
                  <div
                    key={`it_snapshot_${item.id}`}
                    className="rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/10 to-transparent p-6"
                  >
                    <div className="space-y-3">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 font-black uppercase">IT/테크</span>
                      <h3 className="text-base font-bold leading-snug text-slate-900 dark:text-white">{item.title}</h3>
                      <p className="text-2xl font-black text-indigo-600 dark:text-indigo-300">
                        {latestValue !== null ? formatStatValue(item, latestValue) : 'N/A'}
                      </p>
                      <p className="text-xs text-slate-500">{readLatestYear(item) ? `${readLatestYear(item)} 기준` : '최근값 기준연도 없음'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-emerald-500 font-black tracking-widest text-xs">LIVE DISCUSSIONS</span>
            <div className="h-px flex-1 bg-emerald-500/20"></div>
          </div>

          {loading ? (
            <div className="text-slate-500 text-sm font-bold">커뮤니티 데이터를 불러오는 중...</div>
          ) : dbPolls.filter(filterFn).length === 0 ? (
            <div className="rounded-3xl border border-slate-200 dark:border-white/10 p-8 text-sm text-slate-500">
              조건에 맞는 커뮤니티 논제가 없습니다. <Link href="/create" className="text-blue-500 font-bold">첫 논제를 직접 만들어보세요.</Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {dbPolls.filter(filterFn).map((v) => {
                const reliability = getReliability(v.participants || 0);
                return (
                  <Link
                    href={`/vote/${v.id}`}
                    key={v.id}
                    className="group p-8 bg-white border border-slate-200 dark:bg-white/5 dark:border-white/10 rounded-[2rem] hover:bg-slate-100 dark:hover:bg-white/[0.07] transition-all"
                  >
                    <div className="space-y-6">
                      <div className="flex justify-between items-start gap-2">
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded uppercase">
                          {v.category || '커뮤니티'}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors leading-snug">{v.title}</h3>
                      <div className="pt-6 border-t border-slate-200 dark:border-white/5 flex justify-between items-center text-slate-500">
                        <span className="text-xs font-bold">Samples: {v.participants}</span>
                        <span className="text-xl group-hover:translate-x-1 transition-transform">→</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
