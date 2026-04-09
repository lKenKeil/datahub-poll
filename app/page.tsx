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
  if (!created || Number.isNaN(created.getTime())) return participants;
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

type FeaturedBattle = {
  id: string;
  title: string;
  category: string;
  options: string[];
  participants: number;
  official: boolean;
};

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
  const normalizedSearch = useMemo(() => searchTerm.toLowerCase().trim(), [searchTerm]);

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
      refreshTimerRef.current = setTimeout(() => void fetchPolls({ silent: true }), 350);
    };

    const channel = supabase
      .channel('home-polls-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polls' }, scheduleRefresh)
      .subscribe();

    const interval = setInterval(() => void fetchPolls({ silent: true }), 20000);

    return () => {
      clearInterval(interval);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [fetchPolls]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
      statsRefreshTimerRef.current = setTimeout(() => void fetchOfficialStats({ silent: true }), 350);
    };

    const channel = supabase
      .channel('home-official-stats-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'official_statistics' }, scheduleRefresh)
      .subscribe();

    const interval = setInterval(() => void fetchOfficialStats({ silent: true }), 30000);

    return () => {
      clearInterval(interval);
      if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [fetchOfficialStats]);

  const filteredOfficialPolls = useMemo(() => {
    return POLLS.filter((poll) => {
      const categoryMatch = activeCategory === '전체' || poll.category === activeCategory;
      const text = `${poll.title} ${poll.officialFact}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, normalizedSearch]);

  const filteredCommunityPolls = useMemo(() => {
    return dbPolls.filter((poll) => {
      const categoryMatch = activeCategory === '전체' || poll.category === activeCategory;
      const text = `${poll.title} ${poll.category ?? ''}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [dbPolls, activeCategory, normalizedSearch]);

  const trendingPolls = useMemo(() => {
    return [...filteredCommunityPolls]
      .sort((a, b) => getTrendingScore(b) - getTrendingScore(a))
      .slice(0, 4);
  }, [filteredCommunityPolls]);

  const filteredOfficialStats = useMemo(() => {
    return officialStats.filter((stat) => {
      const categoryMatch = activeCategory === '전체' || stat.category === activeCategory;
      const text = `${stat.title} ${stat.summary ?? ''} ${(stat.tags ?? []).join(' ')}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [officialStats, activeCategory, normalizedSearch]);

  const featuredBattle = useMemo<FeaturedBattle | null>(() => {
    if (trendingPolls.length > 0) {
      const top = trendingPolls[0];
      return {
        id: top.id,
        title: top.title,
        category: top.category || '커뮤니티',
        options: top.options,
        participants: top.participants || 0,
        official: false,
      };
    }
    if (filteredOfficialPolls.length > 0) {
      const top = filteredOfficialPolls[0];
      return {
        id: top.id,
        title: top.title,
        category: top.category,
        options: top.options,
        participants: top.participants,
        official: true,
      };
    }
    return null;
  }, [trendingPolls, filteredOfficialPolls]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 selection:bg-blue-500/30">
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-xl border-b border-slate-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-black tracking-tighter flex items-center gap-2 text-slate-900 dark:text-white">
            <span className="bg-blue-600 px-2 py-0.5 rounded text-white">DATA</span>
            <span>HUB.</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/create" className="px-4 py-2 bg-slate-900 text-white dark:bg-white dark:text-black text-sm font-bold rounded-full hover:bg-blue-500 hover:text-white transition-all">
              + 새 데이터 등록
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <section className="grid lg:grid-cols-[260px_1fr_320px] gap-6">
          <aside className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-5">
            <div>
              <p className="text-xs font-black tracking-[0.2em] text-slate-500">NAVIGATION</p>
              <h2 className="text-xl font-black mt-2">카테고리</h2>
            </div>
            <div className="grid gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-left px-3 py-2 rounded-xl text-sm font-bold transition-all ${
                    activeCategory === cat
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="rounded-2xl bg-slate-100 dark:bg-white/5 p-4 text-sm space-y-1">
              <p>오피셜 논제: <span className="font-black">{filteredOfficialPolls.length}</span></p>
              <p>커뮤니티 논제: <span className="font-black">{filteredCommunityPolls.length}</span></p>
              <p>공식 통계: <span className="font-black">{filteredOfficialStats.length}</span></p>
            </div>
          </aside>

          <section className="rounded-3xl border border-slate-200 dark:border-white/10 bg-gradient-to-br from-white to-slate-100 dark:from-slate-900 dark:to-[#020617] p-7 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-black tracking-[0.2em] text-blue-500">TODAY&apos;S BATTLE</p>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight">
                데이터 기반 토론을
                <br />
                더 빠르게 시작하세요
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-sm md:text-base">
                공신력 있는 통계와 실시간 참여형 논제를 한 화면에서 확인하고, 바로 참여할 수 있습니다.
              </p>
            </div>

            <div className="relative rounded-3xl border border-indigo-500/30 bg-indigo-500/10 p-5 space-y-4">
              {featuredBattle ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-black ${featuredBattle.official ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {featuredBattle.official ? 'OFFICIAL' : 'COMMUNITY HOT'}
                    </span>
                    <span className="text-xs text-slate-500">N={featuredBattle.participants.toLocaleString()}</span>
                  </div>
                  <h3 className="text-2xl font-black leading-snug">{featuredBattle.title}</h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {featuredBattle.options.slice(0, 2).map((opt, idx) => (
                      <div key={`${featuredBattle.id}_${idx}`} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4 text-sm font-bold">
                        {opt}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/vote/${featuredBattle.id}`} className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-black hover:bg-blue-500">
                      이 논제 참여하기
                    </Link>
                    <a href="#official-intel-feed" className="px-4 py-2 rounded-full border border-slate-300 dark:border-white/15 text-sm font-black hover:border-blue-500/60">
                      통계 먼저 보기
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">현재 표시할 배틀 논제가 없습니다.</p>
              )}
            </div>
          </section>

          <aside className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-black tracking-[0.2em] text-cyan-500">LIVE PULSE</p>
              <h2 className="text-lg font-black">실시간 핵심 지표</h2>
            </div>
            {statsLoading ? (
              <p className="text-sm text-slate-500">불러오는 중...</p>
            ) : filteredOfficialStats.length === 0 ? (
              <p className="text-sm text-slate-500">표시할 통계가 없습니다.</p>
            ) : (
              <div className="grid gap-3">
                {filteredOfficialStats.slice(0, 3).map((stat) => {
                  const value = readLatestValue(stat);
                  return (
                    <Link key={stat.id} href={`/stats/${stat.id}`} className="rounded-2xl border border-slate-200 dark:border-white/10 p-3 hover:border-cyan-500/50">
                      <p className="text-[11px] text-slate-500">{stat.category}</p>
                      <p className="text-sm font-bold leading-snug mt-1">{stat.title}</p>
                      <p className="text-cyan-500 text-lg font-black mt-2">
                        {value !== null ? formatStatValue(stat, value) : 'N/A'}
                      </p>
                      <p className="text-[11px] text-slate-500">{readLatestYear(stat) ?? 'year n/a'}</p>
                    </Link>
                  );
                })}
              </div>
            )}
          </aside>
        </section>

        <section>
          <div className="max-w-3xl mx-auto">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-6 py-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-lg font-bold placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              placeholder="논제, 통계, 태그 검색..."
            />
          </div>
        </section>

        <section id="official-intel-feed" className="space-y-6">
          <div className="flex items-center gap-4">
            <span className="text-cyan-500 font-black tracking-widest text-xs">OFFICIAL INTEL FEED</span>
            <div className="h-px flex-1 bg-cyan-500/20" />
          </div>
          {statsLoading ? (
            <div className="text-sm text-slate-500 font-bold">공식 통계를 불러오는 중...</div>
          ) : filteredOfficialStats.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 dark:border-white/10 p-8 text-sm text-slate-500">
              검색/카테고리 조건에 맞는 공식 통계가 없습니다.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredOfficialStats.map((item) => {
                const latestValue = readLatestValue(item);
                const latestYear = readLatestYear(item);
                const opened = openStatId === item.id;
                return (
                  <article key={item.id} className="rounded-3xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 p-5 space-y-3 hover:border-cyan-500/40 transition-all">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400 font-black uppercase">{item.category}</span>
                      <span className="text-[11px] text-slate-500">{item.published_at ?? item.observed_at ?? 'date n/a'}</span>
                    </div>
                    <h3 className="text-lg font-black leading-snug">{item.title}</h3>
                    {latestValue !== null ? (
                      <div className="inline-flex items-end gap-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25 px-3 py-2">
                        <span className="text-cyan-600 dark:text-cyan-300 text-xl font-black">{formatStatValue(item, latestValue)}</span>
                        <span className="text-[11px] text-cyan-700/80 dark:text-cyan-200/80 font-bold">{latestYear ? `(${latestYear})` : ''}</span>
                      </div>
                    ) : null}
                    {item.summary ? <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{item.summary}</p> : null}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setOpenStatId(opened ? null : item.id)}
                        className="px-3 py-1.5 text-xs rounded-full border border-slate-300 dark:border-white/20 hover:border-cyan-500/50"
                      >
                        {opened ? '접기' : '인사이트'}
                      </button>
                      <Link href={`/stats/${item.id}`} className="px-3 py-1.5 text-xs rounded-full bg-indigo-600 text-white hover:bg-indigo-500">
                        통계 보기
                      </Link>
                    </div>

                    {opened ? (
                      <div className="mt-2 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] p-3 space-y-2">
                        {item.methodology ? <p className="text-xs text-slate-700 dark:text-slate-300"><span className="font-black">방법론:</span> {item.methodology}</p> : null}
                        {item.confidence_note ? <p className="text-xs text-slate-700 dark:text-slate-300"><span className="font-black">신뢰 참고:</span> {item.confidence_note}</p> : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section id="live-discussions" className="space-y-6">
          <div className="flex items-center gap-4">
            <span className="text-emerald-500 font-black tracking-widest text-xs">LIVE DISCUSSIONS</span>
            <div className="h-px flex-1 bg-emerald-500/20" />
          </div>
          {loading ? (
            <div className="text-sm text-slate-500 font-bold">커뮤니티 데이터를 불러오는 중...</div>
          ) : filteredCommunityPolls.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 dark:border-white/10 p-8 text-sm text-slate-500">
              조건에 맞는 커뮤니티 논제가 없습니다. <Link href="/create" className="text-blue-500 font-bold">첫 논제를 직접 만들어보세요.</Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredCommunityPolls.map((poll) => {
                const reliability = getReliability(poll.participants || 0);
                return (
                  <Link key={poll.id} href={`/vote/${poll.id}`} className="group p-6 bg-white border border-slate-200 dark:bg-white/5 dark:border-white/10 rounded-[1.6rem] hover:bg-slate-100 dark:hover:bg-white/[0.07] transition-all">
                    <div className="space-y-4">
                      <div className="flex justify-between items-start gap-2">
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded uppercase">{poll.category || '커뮤니티'}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
                      </div>
                      <h3 className="text-lg font-bold leading-snug">{poll.title}</h3>
                      <div className="pt-4 border-t border-slate-200 dark:border-white/5 flex justify-between items-center text-slate-500">
                        <span className="text-xs font-bold">Samples: {poll.participants}</span>
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
