'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { POLLS } from '../data/polls';
import { DbPoll, OfficialStatistic } from '../lib/types';
import { supabase } from '../lib/supabase';

type HomeCategory =
  | '전체'
  | '연애/관계'
  | '게임'
  | '스포츠'
  | '음식'
  | '엔터/콘텐츠'
  | 'IT/제품'
  | '라이프'
  | '가치관'
  | '데이터';

const categories: HomeCategory[] = [
  '전체',
  '연애/관계',
  '게임',
  '스포츠',
  '음식',
  '엔터/콘텐츠',
  'IT/제품',
  '라이프',
  '가치관',
  '데이터',
];

type CategorySource = {
  title: string;
  category?: string | null;
  options?: string[] | null;
  tags?: string[] | null;
};

function getInterestCategory(item: CategorySource): Exclude<HomeCategory, '전체'> {
  const text = `${item.title} ${item.category ?? ''} ${(item.options ?? []).join(' ')} ${(item.tags ?? []).join(' ')}`.toLowerCase();
  const keywordGroups: Array<[Exclude<HomeCategory, '전체'>, string[]]> = [
    ['연애/관계', ['연애', '사랑', '결혼', '썸', '친구', '관계']],
    ['게임', ['게임', '콘솔', '롤', '오버워치', '닌텐도', '스팀']],
    ['스포츠', ['스포츠', '축구', '야구', '농구', '배구', '선수']],
    ['음식', ['음식', '메뉴', '치킨', '피자', '짜장', '짬뽕', '커피', '맛집']],
    ['엔터/콘텐츠', ['영화', '드라마', '음악', '아이돌', '유튜브', '콘텐츠', '웹툰']],
    ['IT/제품', ['it/테크', '아이폰', '갤럭시', '노트북', '스마트폰', '소프트웨어', '제품']],
    ['라이프', ['라이프스타일', '생활', '여행', '패션', '건강', '취미']],
    ['데이터', ['학술/통계', '통계', '데이터', '지표', '인구', '경제성장률']],
  ];

  const matched = keywordGroups.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)));
  if (matched) return matched[0];
  if (item.category === '라이프스타일') return '라이프';
  if (item.category === 'IT/테크') return 'IT/제품';
  if (item.category === '학술/통계') return '데이터';
  return '가치관';
}

function getTrendingScore(poll: DbPoll) {
  const participants = poll.participants ?? 0;
  const tightRaceBoost = isTightRace(poll.votes) ? 120 : 0;
  const created = poll.created_at ? new Date(poll.created_at) : null;
  if (!created || Number.isNaN(created.getTime())) return participants + tightRaceBoost;
  const ageHours = Math.max(0, (Date.now() - created.getTime()) / (1000 * 60 * 60));
  const freshnessBoost = Math.max(0, 36 - ageHours) * 8;
  return participants + freshnessBoost + tightRaceBoost;
}

function isTightRace(votes?: number[]) {
  if (!votes || votes.length < 2) return false;
  const total = votes.reduce((sum, vote) => sum + vote, 0);
  if (total < 10) return false;
  const sorted = [...votes].sort((a, b) => b - a);
  return ((sorted[0] - sorted[1]) / total) * 100 <= 8;
}

function isFreshPoll(poll: DbPoll) {
  const created = poll.created_at ? new Date(poll.created_at) : null;
  if (!created || Number.isNaN(created.getTime())) return false;
  const ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);
  return ageHours <= 72;
}

function isHotPoll(poll: DbPoll) {
  return (poll.participants ?? 0) >= 20 || isTightRace(poll.votes) || (isFreshPoll(poll) && (poll.participants ?? 0) >= 5);
}

function getRisingScore(poll: DbPoll) {
  const created = poll.created_at ? new Date(poll.created_at) : null;
  const ageHours = created && !Number.isNaN(created.getTime())
    ? Math.max(0, (Date.now() - created.getTime()) / (1000 * 60 * 60))
    : 72;
  const freshness = Math.max(0, 72 - ageHours) * 10;
  const participation = Math.log2((poll.participants ?? 0) + 1) * 45;
  return freshness + participation + (isTightRace(poll.votes) ? 80 : 0);
}

function formatRelativeTime(value?: string) {
  if (!value) return '방금 전';
  const created = new Date(value);
  if (Number.isNaN(created.getTime())) return '최근 등록';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - created.getTime()) / (1000 * 60)));
  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}일 전`;
  return created.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
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
  if (
    indicatorId === 'IT.NET.USER.ZS' ||
    indicatorId === 'SL.UEM.1524.ZS' ||
    indicatorId === 'SL.UEM.TOTL.ZS' ||
    indicatorId === 'FP.CPI.TOTL.ZG'
  ) return `${value.toFixed(2)}%`;
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
  const [activeCategory, setActiveCategory] = useState<HomeCategory>('전체');
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
      const categoryMatch = activeCategory === '전체' || getInterestCategory(poll) === activeCategory;
      const text = `${poll.title} ${poll.officialFact}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, normalizedSearch]);

  const filteredCommunityPolls = useMemo(() => {
    return dbPolls.filter((poll) => {
      const categoryMatch = activeCategory === '전체' || getInterestCategory(poll) === activeCategory;
      const text = `${poll.title} ${poll.category ?? ''} ${poll.options.join(' ')}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [dbPolls, activeCategory, normalizedSearch]);

  const rankedCommunityPolls = useMemo(() => {
    return [...filteredCommunityPolls]
      .sort((a, b) => getTrendingScore(b) - getTrendingScore(a));
  }, [filteredCommunityPolls]);

  const popularPolls = useMemo(() => rankedCommunityPolls.slice(0, 6), [rankedCommunityPolls]);

  const risingPolls = useMemo(() => {
    const popularIds = new Set(popularPolls.map((poll) => poll.id));
    const distinctCandidates = filteredCommunityPolls.filter((poll) => !popularIds.has(poll.id));
    const candidates = distinctCandidates.length > 0
      ? distinctCandidates
      : filteredCommunityPolls.filter((poll) => poll.id !== rankedCommunityPolls[0]?.id);
    return [...candidates]
      .sort((a, b) => getRisingScore(b) - getRisingScore(a))
      .slice(0, 4);
  }, [filteredCommunityPolls, popularPolls, rankedCommunityPolls]);

  const latestPolls = useMemo(() => {
    return [...filteredCommunityPolls].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [filteredCommunityPolls]);

  const filteredOfficialStats = useMemo(() => {
    return officialStats.filter((stat) => {
      const categoryMatch = activeCategory === '전체' || getInterestCategory(stat) === activeCategory;
      const text = `${stat.title} ${stat.summary ?? ''} ${(stat.tags ?? []).join(' ')}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [officialStats, activeCategory, normalizedSearch]);

  const featuredBattle = useMemo<FeaturedBattle | null>(() => {
    if (rankedCommunityPolls.length > 0) {
      const top = rankedCommunityPolls[0];
      return {
        id: top.id,
        title: top.title,
        category: getInterestCategory(top),
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
        category: getInterestCategory(top),
        options: top.options,
        participants: top.participants,
        official: true,
      };
    }
    return null;
  }, [rankedCommunityPolls, filteredOfficialPolls]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 selection:bg-blue-500/30">
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-[#020617]/80 backdrop-blur-xl border-b border-slate-200 dark:border-white/5">
        <div className="max-w-[1440px] mx-auto px-4 pr-24 sm:pl-6 sm:pr-28 lg:pl-8 lg:pr-28 py-3 flex items-center gap-5">
          <Link href="/" className="text-2xl font-black tracking-tighter flex items-center gap-2 text-slate-900 dark:text-white">
            <span className="bg-blue-600 px-2 py-0.5 rounded text-white">DATA</span>
            <span>HUB.</span>
          </Link>
          <label className="hidden md:block relative ml-auto w-full max-w-xl">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-full border border-slate-200 bg-slate-100/80 py-2.5 pl-10 pr-4 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5"
              placeholder="재미있는 투표를 찾아보세요"
            />
          </label>
          <Link href="/create" className="ml-auto md:ml-0 shrink-0 px-4 py-2.5 bg-slate-900 text-white dark:bg-white dark:text-black text-sm font-black rounded-full hover:bg-blue-600 hover:text-white transition-all">
            + 투표 만들기
          </Link>
        </div>
        <div className="md:hidden px-4 pb-3">
          <label className="relative block">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full rounded-full border border-slate-200 bg-slate-100 py-2.5 pl-10 pr-4 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5"
              placeholder="투표 검색"
            />
          </label>
        </div>
      </nav>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 space-y-14 md:space-y-20">
        <section className="relative overflow-hidden rounded-[2rem] border border-blue-200/70 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-6 shadow-[0_24px_80px_-48px_rgba(37,99,235,0.65)] dark:border-blue-500/20 dark:from-slate-900 dark:via-[#07152f] dark:to-[#052631] md:p-10 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:items-center lg:gap-12">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative space-y-6">
            <div className="space-y-3">
              <p className="inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-600 dark:text-blue-300">실시간 투표</p>
              <h1 className="text-4xl font-black tracking-[-0.04em] leading-[1.08] text-slate-950 dark:text-white md:text-6xl">
                사람들은 지금
                <br className="hidden sm:block" /> 뭘 고르고 있을까?
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300 md:text-lg">
                쉽게 하나를 고르고, 다른 사람들의 선택과 의견을 바로 확인해보세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a href="#popular-polls" className="rounded-full bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500">
                인기 투표 보기
              </a>
              <Link href="/create" className="rounded-full border border-slate-300 bg-white/70 px-5 py-3 text-sm font-black transition hover:border-blue-500 dark:border-white/15 dark:bg-white/5">
                내 투표 만들기
              </Link>
            </div>
          </div>

          <div className="relative mt-8 rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-xl shadow-blue-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/65 md:p-7 lg:mt-0">
              {featuredBattle ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-orange-500/15 px-2.5 py-1 text-[11px] font-black text-orange-600 dark:text-orange-300">
                        {featuredBattle.official ? '오늘의 투표' : 'HOT'}
                      </span>
                      <span className="text-xs font-bold text-blue-600 dark:text-cyan-300">{featuredBattle.category}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-500">참여자 {featuredBattle.participants.toLocaleString()}명</span>
                  </div>
                  <h2 className="mt-4 text-2xl font-black leading-snug text-slate-950 dark:text-white md:text-3xl">{featuredBattle.title}</h2>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {featuredBattle.options.slice(0, 4).map((option, index) => (
                      <div key={`${featuredBattle.id}_${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold dark:border-white/10 dark:bg-white/5">
                        <span className="mr-2 text-blue-500">{index + 1}</span>
                        {option}
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-white/10">
                    <span className="text-xs font-semibold text-slate-500">결과는 투표 후 확인할 수 있어요</span>
                    <Link href={`/vote/${featuredBattle.id}`} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-blue-500">
                      투표하기 →
                    </Link>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm text-slate-500">지금 참여할 수 있는 투표가 없어요.</p>
                  <Link href="/create" className="mt-3 inline-flex text-sm font-black text-blue-500">첫 투표 만들기 →</Link>
                </div>
              )}
          </div>
        </section>

        <section id="popular-polls" className="scroll-mt-32 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black tracking-tight md:text-3xl">🔥 실시간 인기</h2>
              <p className="mt-2 text-sm text-slate-500">참여자 수와 접전 여부, 최신성을 함께 반영했어요.</p>
            </div>
            <Link href="/create" className="text-sm font-black text-blue-600 hover:text-blue-500 dark:text-blue-300">+ 새 투표 만들기</Link>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">인기 투표를 불러오는 중...</div>
          ) : popularPolls.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/50 p-8 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.02]">
              지금 조건에 맞는 인기 투표가 없어요. 다른 관심사를 선택해보세요.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {popularPolls.map((poll) => (
                <Link
                  key={poll.id}
                  href={`/vote/${poll.id}`}
                  className="group flex min-h-52 flex-col rounded-[1.6rem] border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-950/5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-blue-400/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-blue-600 dark:text-cyan-300">{getInterestCategory(poll)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isTightRace(poll.votes) ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300' : isHotPoll(poll) ? 'bg-orange-500/15 text-orange-600 dark:text-orange-300' : 'bg-blue-500/10 text-blue-600 dark:text-blue-300'}`}>
                      {isTightRace(poll.votes) ? '접전 중' : isHotPoll(poll) ? 'HOT' : '인기'}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-black leading-snug text-slate-950 dark:text-white">{poll.title}</h3>
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-5 text-sm dark:border-white/10">
                    <span className="font-bold text-slate-500">참여자 {(poll.participants ?? 0).toLocaleString()}명</span>
                    <span className="font-black text-blue-600 transition-transform group-hover:translate-x-1 dark:text-blue-300">투표하러 가기 →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-black tracking-tight md:text-3xl">📈 지금 뜨는 투표</h2>
            <p className="mt-2 text-sm text-slate-500">최근 등록된 투표의 참여도와 접전 여부를 기준으로 정렬했어요.</p>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">급상승 투표를 불러오는 중...</div>
          ) : risingPolls.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-sm text-slate-500 dark:border-white/10">새로 뜨는 투표를 집계하고 있어요.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {risingPolls.map((poll, index) => (
                <Link key={poll.id} href={`/vote/${poll.id}`} className="group flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5 transition hover:border-cyan-500/60 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-lg font-black text-cyan-600 dark:text-cyan-300">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                      <span className="text-blue-600 dark:text-cyan-300">{getInterestCategory(poll)}</span>
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-300">{isFreshPoll(poll) ? '새로 뜨는 중' : '주목받는 투표'}</span>
                    </div>
                    <h3 className="mt-1.5 truncate text-base font-black text-slate-950 dark:text-white">{poll.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">참여자 {(poll.participants ?? 0).toLocaleString()}명</p>
                  </div>
                  <span className="text-blue-500 transition-transform group-hover:translate-x-1">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="category-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="category-heading" className="text-2xl font-black tracking-tight">관심사로 찾기</h2>
              <p className="mt-1.5 text-sm text-slate-500">내가 좋아하는 주제만 모아보세요.</p>
            </div>
            {activeCategory !== '전체' ? <span className="text-sm font-bold text-blue-600 dark:text-blue-300">{activeCategory} 투표 보는 중</span> : null}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-black transition ${activeCategory === category ? 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/20' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}
              >
                {category}
              </button>
            ))}
          </div>
        </section>

        <section id="latest-polls" className="space-y-6">
          <div>
            <h2 className="text-2xl font-black tracking-tight md:text-3xl">🆕 새로 올라온 투표</h2>
            <p className="mt-2 text-sm text-slate-500">방금 만들어진 투표부터 확인해보세요.</p>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">최신 투표를 불러오는 중...</div>
          ) : latestPolls.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white/50 p-8 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.02]">
              조건에 맞는 투표가 없어요. <Link href="/create" className="font-black text-blue-500">첫 투표를 만들어보세요.</Link>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {latestPolls.map((poll) => (
                <Link key={poll.id} href={`/vote/${poll.id}`} className="group flex flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 transition hover:border-blue-400 hover:bg-blue-50/40 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-blue-500/[0.06]">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold">
                    <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-600 dark:text-blue-300">{getInterestCategory(poll)}</span>
                    <span className="text-slate-400">{formatRelativeTime(poll.created_at)}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-black leading-snug text-slate-950 dark:text-white">{poll.title}</h3>
                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs dark:border-white/10">
                    <span className="font-bold text-slate-500">참여자 {(poll.participants ?? 0).toLocaleString()}명</span>
                    <span className="font-black text-blue-600 transition-transform group-hover:translate-x-1 dark:text-blue-300">투표하러 가기 →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="official-intel-feed" className="space-y-6 rounded-[2rem] border border-cyan-500/15 bg-gradient-to-br from-cyan-50/70 to-blue-50/40 p-6 dark:from-cyan-950/20 dark:to-blue-950/10 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black tracking-tight md:text-3xl">📊 데이터로 보는 세상</h2>
              <p className="mt-2 text-sm text-slate-500">투표 뒤에 있는 흐름을 공식 통계로 확인해보세요.</p>
            </div>
            <span className="text-xs font-bold text-cyan-700 dark:text-cyan-300">신뢰할 수 있는 공식 출처</span>
          </div>
          {statsLoading ? (
            <div className="text-sm font-bold text-slate-500">공식 통계를 불러오는 중...</div>
          ) : filteredOfficialStats.length === 0 ? (
            <div className="rounded-3xl border border-cyan-500/15 bg-white/60 p-8 text-sm text-slate-500 dark:bg-white/[0.03]">
              검색과 관심사 조건에 맞는 공식 통계가 없어요.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredOfficialStats.slice(0, 6).map((item) => {
                const latestValue = readLatestValue(item);
                const latestYear = readLatestYear(item);
                const opened = openStatId === item.id;
                return (
                  <article key={item.id} className="rounded-3xl border border-slate-200 bg-white/90 p-5 transition hover:border-cyan-500/50 dark:border-white/10 dark:bg-slate-950/55">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-[11px] font-black text-cyan-700 dark:text-cyan-300">{item.category}</span>
                      <span className="text-[11px] font-semibold text-slate-400">{latestYear ? `최근 ${latestYear}` : item.published_at ?? item.observed_at ?? '최근 공개'}</span>
                    </div>
                    <h3 className="mt-4 text-lg font-black leading-snug text-slate-950 dark:text-white">{item.title}</h3>
                    {latestValue !== null ? (
                      <p className="mt-3 text-2xl font-black text-cyan-600 dark:text-cyan-300">{formatStatValue(item, latestValue)}</p>
                    ) : null}
                    {item.summary ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.summary}</p> : null}
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => setOpenStatId(opened ? null : item.id)}
                        className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold hover:border-cyan-500 dark:border-white/20"
                      >
                        {opened ? '접기' : '요약 보기'}
                      </button>
                      <Link href={`/stats/${item.id}`} className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-500">
                        관련 데이터 보기
                      </Link>
                    </div>
                    {opened ? (
                      <div className="mt-3 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
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
      </main>
    </div>
  );
}
