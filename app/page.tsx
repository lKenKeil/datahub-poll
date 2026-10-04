'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BrandHomeLink } from '@/components/brand-home-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { AuthButton } from '@/components/auth-button';
import { BRAND } from '@/lib/brand';
import { ALL_CATEGORY_PRESENTATION, CATEGORY_PRESENTATION, type CategoryPresentation } from '@/lib/category-presentation';
import { trackPollCardClicked } from '@/lib/analytics';
import { getInterestCategory, selectDiverseLatestPolls, selectUniquePollTopics } from '@/lib/poll-discovery';
import { POLLS } from '../data/polls';
import { DbPoll, OfficialStatistic } from '../lib/types';
import { supabase } from '../lib/supabase';
import {
  getPollOptionImagePublicUrl,
  normalizeOptionImagePaths,
} from '../lib/poll-option-image-paths';

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

const categoryDisplay: Record<HomeCategory, CategoryPresentation> = {
  '전체': ALL_CATEGORY_PRESENTATION,
  '연애/관계': CATEGORY_PRESENTATION['연애·관계'],
  '게임': CATEGORY_PRESENTATION['게임'],
  '스포츠': CATEGORY_PRESENTATION['스포츠'],
  '음식': CATEGORY_PRESENTATION['음식'],
  '엔터/콘텐츠': CATEGORY_PRESENTATION['엔터·콘텐츠'],
  'IT/제품': CATEGORY_PRESENTATION['IT·제품'],
  '라이프': CATEGORY_PRESENTATION['라이프'],
  '가치관': CATEGORY_PRESENTATION['가치관'],
  '데이터': CATEGORY_PRESENTATION['데이터'],
};

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

function getPollOutcomeLabel(poll: DbPoll) {
  const votes = poll.votes ?? [];
  const total = votes.reduce((sum, vote) => sum + vote, 0);
  if (poll.options.length !== 2 || votes.length !== 2 || (poll.participants ?? 0) < 10 || total < 10) {
    return null;
  }

  const gap = (Math.abs(votes[0] - votes[1]) / total) * 100;
  if (gap <= 10) return '거의 반반';
  if (gap <= 25) return '의견이 갈렸어요';
  return '한쪽으로 기울었어요';
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

function getCreatedAtTime(poll: DbPoll) {
  if (!poll.created_at) return 0;
  const time = new Date(poll.created_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function comparePollIds(a: DbPoll, b: DbPoll) {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function compareByCreatedAtDesc(a: DbPoll, b: DbPoll) {
  const createdAtDifference = getCreatedAtTime(b) - getCreatedAtTime(a);
  return createdAtDifference || comparePollIds(a, b);
}

function compareByTrendingScore(a: DbPoll, b: DbPoll) {
  const scoreDifference = getTrendingScore(b) - getTrendingScore(a);
  return scoreDifference || compareByCreatedAtDesc(a, b);
}

function compareByRisingScore(a: DbPoll, b: DbPoll) {
  const scoreDifference = getRisingScore(b) - getRisingScore(a);
  return scoreDifference || compareByCreatedAtDesc(a, b);
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
  analyticsCategory: string;
  options: string[];
  participants: number;
  official: boolean;
  option_image_paths?: Array<string | null> | null;
};

type PollImageSource = Pick<DbPoll, 'id' | 'options' | 'option_image_paths'>;

function getPollPreviewImageUrls(poll: PollImageSource) {
  const paths = normalizeOptionImagePaths(poll.option_image_paths, poll.options.length);
  if (!paths) return [];

  return paths
    .map((path, optionIndex) => getPollOptionImagePublicUrl(
      supabase,
      poll.id,
      optionIndex,
      path,
    ))
    .filter((url): url is string => Boolean(url))
    .slice(0, 2);
}

function PollOptionImagePreview({
  poll,
  variant,
  eager = false,
  badge,
  fallback = null,
}: {
  poll: PollImageSource;
  variant: 'hero' | 'compact';
  eager?: boolean;
  badge?: string;
  fallback?: ReactNode;
}) {
  const imageUrls = getPollPreviewImageUrls(poll);
  if (imageUrls.length === 0) return fallback;

  const containerClass = variant === 'hero'
    ? 'mb-3 aspect-[16/7] w-full rounded-2xl'
    : 'h-20 w-24 shrink-0 rounded-2xl sm:w-28';
  const imageSizes = variant === 'hero'
    ? imageUrls.length > 1
      ? '(max-width: 1024px) 45vw, 280px'
      : '(max-width: 1024px) calc(100vw - 80px), 560px'
    : '112px';

  return (
    <div
      aria-hidden="true"
      className={`relative grid min-w-0 grid-flow-col overflow-hidden bg-surface-muted dark:bg-surface-muted ${imageUrls.length > 1 ? 'grid-cols-2 gap-px' : 'grid-cols-1'} ${containerClass}`}
    >
      {imageUrls.map((url, index) => (
        <div key={url} className="relative min-w-0 overflow-hidden">
          <Image
            src={url}
            alt=""
            fill
            sizes={imageSizes}
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : 'auto'}
            className="object-cover transition duration-300 group-hover:scale-[1.02]"
          />
          {imageUrls.length > 1 ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-slate-950/65 px-2 py-1 text-xs font-bold text-white backdrop-blur-sm">
              {index + 1}
            </span>
          ) : null}
        </div>
      ))}
      {badge ? (
        <span className="absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-lg bg-primary px-2 text-xs font-black text-white shadow-sm">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function PollChoiceHint({ options }: { options: string[] }) {
  if (options.length < 2) return null;

  return (
    <div className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm font-bold text-ink">
      {options.slice(0, 2).map((option, index) => (
        <Fragment key={index}>
          {index === 1 ? <span aria-hidden="true" className="text-xs font-bold tracking-wider text-muted dark:text-muted">VS</span> : null}
          <div className="flex min-w-0 justify-center">
            <div className="inline-flex min-w-0 max-w-full items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-xs font-extrabold text-link">{index + 1}</span>
              <span className="line-clamp-2 min-w-0 break-words text-left leading-snug">{option}</span>
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// Images share the option row rather than adding a separate card-height tier.
function PollChoiceRail({ poll }: { poll: PollImageSource }) {
  const paths = normalizeOptionImagePaths(poll.option_image_paths, poll.options.length);

  return (
    <div className="poll-choice-rail mt-3 grid min-h-20 min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl bg-primary-soft px-2 py-2 text-base font-bold text-ink md:px-3 md:text-lg">
      {poll.options.slice(0, 2).map((option, index) => {
        const imageUrl = getPollOptionImagePublicUrl(supabase, poll.id, index, paths?.[index]);
        return (
          <Fragment key={index}>
            {index === 1 ? <span aria-hidden="true" className="text-xs font-bold tracking-wider text-muted">VS</span> : null}
            <div className="flex min-w-0 justify-center">
              <div className="inline-flex min-w-0 max-w-full items-center gap-2">
                {imageUrl ? (
                  <span className="relative size-10 shrink-0">
                    <Image src={imageUrl} alt="" fill sizes="40px" loading="lazy" className="rounded-lg object-cover" />
                    <span className="absolute -bottom-1 -left-1 flex size-5 items-center justify-center rounded-md bg-primary text-xs font-extrabold text-white">{index + 1}</span>
                  </span>
                ) : (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-extrabold text-white md:size-8 md:text-sm">{index + 1}</span>
                )}
                <span className="line-clamp-2 min-w-0 break-words text-left leading-5 md:leading-6">{option}</span>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function PollCommunitySignals({ poll, showCreatedAt = false }: { poll: DbPoll; showCreatedAt?: boolean }) {
  const outcomeLabel = getPollOutcomeLabel(poll);
  const participants = poll.participants ?? 0;
  const signals = [
    outcomeLabel ? { label: outcomeLabel, emphasized: true } : null,
    participants > 0 ? { label: `${participants.toLocaleString()}명 참여`, emphasized: false } : null,
    showCreatedAt ? { label: formatRelativeTime(poll.created_at), emphasized: false } : null,
  ].filter((signal): signal is { label: string; emphasized: boolean } => signal !== null);

  if (signals.length === 0) return null;

  return (
    <div aria-label="활동 정보" className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {signals.map((signal, index) => (
        <span key={`${signal.label}-${index}`} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 ? <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span> : null}
          <span className={signal.emphasized ? 'font-bold text-link dark:text-link' : 'font-medium text-muted dark:text-muted'}>
            {signal.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function Home() {
  const [dbPolls, setDbPolls] = useState<DbPoll[]>([]);
  const [unavailableOfficialPollIds, setUnavailableOfficialPollIds] = useState<string[] | null>(null);
  const [officialStats, setOfficialStats] = useState<OfficialStatistic[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<HomeCategory>('전체');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [openStatId, setOpenStatId] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRequestGenerationRef = useRef(0);
  const statsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const officialIdSet = useMemo(() => new Set(POLLS.map((poll) => poll.id)), []);
  const normalizedSearch = useMemo(() => searchTerm.toLowerCase().trim(), [searchTerm]);

  const fetchPolls = useCallback(async (options?: { silent?: boolean }) => {
    const generation = ++pollRequestGenerationRef.current;
    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/polls', { cache: 'no-store' });
      const json = (await response.json()) as { data?: DbPoll[]; unavailableOfficialPollIds?: string[]; error?: string };
      if (generation !== pollRequestGenerationRef.current) return;
      if (!response.ok) {
        console.error('데이터 로딩 실패:', json.error ?? 'unknown error');
        setDbPolls([]);
        setUnavailableOfficialPollIds(null);
        return;
      }
      setUnavailableOfficialPollIds(json.unavailableOfficialPollIds ?? []);
      const rows = (json.data ?? []).filter((poll) => {
        return poll.id.startsWith('custom_') || !officialIdSet.has(poll.id.replace('official_', ''));
      });
      setDbPolls(rows);
    } catch {
      if (generation !== pollRequestGenerationRef.current) return;
      setDbPolls([]);
      setUnavailableOfficialPollIds(null);
    } finally {
      if (generation === pollRequestGenerationRef.current) setLoading(false);
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
    return () => { pollRequestGenerationRef.current += 1; };
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
    if (unavailableOfficialPollIds === null) return [];
    return POLLS.filter((poll) => {
      if (unavailableOfficialPollIds.includes(`official_${poll.id}`)) return false;
      const categoryMatch = activeCategory === '전체' || getInterestCategory(poll) === activeCategory;
      const text = `${poll.title} ${poll.officialFact}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, normalizedSearch, unavailableOfficialPollIds]);

  const filteredCommunityPolls = useMemo(() => {
    return dbPolls.filter((poll) => {
      const categoryMatch = activeCategory === '전체' || getInterestCategory(poll) === activeCategory;
      const text = `${poll.title} ${poll.category ?? ''} ${poll.options.join(' ')}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [dbPolls, activeCategory, normalizedSearch]);

  const rankedActiveCommunityPolls = useMemo(() => {
    return filteredCommunityPolls
      .filter((poll) => (poll.participants ?? 0) > 0)
      .sort(compareByTrendingScore);
  }, [filteredCommunityPolls]);

  const latestCommunityPolls = useMemo(() => {
    return [...filteredCommunityPolls].sort(compareByCreatedAtDesc);
  }, [filteredCommunityPolls]);

  const featuredCommunityPoll = rankedActiveCommunityPolls[0]
    ?? latestCommunityPolls[0]
    ?? null;

  const popularPolls = useMemo(() => {
    return selectUniquePollTopics(rankedActiveCommunityPolls, featuredCommunityPoll ? [featuredCommunityPoll] : [], 6);
  }, [featuredCommunityPoll, rankedActiveCommunityPolls]);

  const risingPolls = useMemo(() => {
    const shownPolls = [
      ...(featuredCommunityPoll ? [featuredCommunityPoll] : []),
      ...popularPolls,
    ];
    const candidates = filteredCommunityPolls
      .filter((poll) => (
        (poll.participants ?? 0) > 0
        && isFreshPoll(poll)
      ))
      .sort(compareByRisingScore);
    return selectUniquePollTopics(candidates, shownPolls, 4);
  }, [featuredCommunityPoll, filteredCommunityPolls, popularPolls]);

  const latestPolls = useMemo(() => {
    const shownPolls = [
      ...(featuredCommunityPoll ? [featuredCommunityPoll] : []),
      ...popularPolls,
      ...risingPolls,
    ];
    return selectDiverseLatestPolls(latestCommunityPolls, shownPolls);
  }, [featuredCommunityPoll, latestCommunityPolls, popularPolls, risingPolls]);

  const filteredOfficialStats = useMemo(() => {
    return officialStats.filter((stat) => {
      const categoryMatch = activeCategory === '전체' || getInterestCategory(stat) === activeCategory;
      const text = `${stat.title} ${stat.summary ?? ''} ${(stat.tags ?? []).join(' ')}`.toLowerCase();
      const searchMatch = !normalizedSearch || text.includes(normalizedSearch);
      return categoryMatch && searchMatch;
    });
  }, [officialStats, activeCategory, normalizedSearch]);

  const featuredBattle = useMemo<FeaturedBattle | null>(() => {
    if (featuredCommunityPoll) {
      return {
        id: featuredCommunityPoll.id,
        title: featuredCommunityPoll.title,
        category: getInterestCategory(featuredCommunityPoll),
        analyticsCategory: featuredCommunityPoll.category || '커뮤니티',
        options: featuredCommunityPoll.options,
        participants: featuredCommunityPoll.participants || 0,
        official: false,
        option_image_paths: featuredCommunityPoll.option_image_paths,
      };
    }
    if (filteredOfficialPolls.length > 0) {
      const top = filteredOfficialPolls[0];
      return {
        id: top.id,
        title: top.title,
        category: getInterestCategory(top),
        analyticsCategory: top.category,
        options: top.options,
        participants: top.participants,
        official: true,
        option_image_paths: null,
      };
    }
    return null;
  }, [featuredCommunityPoll, filteredOfficialPolls]);

  const activeCategoryDisplay = categoryDisplay[activeCategory];
  const latestSectionTitle = activeCategory === '전체'
    ? '새로 올라온 투표'
    : `${activeCategoryDisplay.label} 질문`;
  const latestSectionDescription = activeCategory === '전체'
    ? '방금 만들어진 투표부터 확인해보세요.'
    : `${activeCategoryDisplay.label}에서 사람들이 최근 궁금해한 것들이에요.`;
  const emptyLatestTitle = normalizedSearch
    ? `“${searchTerm.trim()}”과 맞는 질문을 찾지 못했어요.`
    : activeCategory === '전체'
      ? '아직 새로 소개할 질문이 없어요.'
      : `아직 ${activeCategoryDisplay.label}엔 질문이 많지 않아요.`;

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full bg-canvas text-ink dark:bg-canvas dark:text-ink selection:bg-blue-500/30">
      <nav className="sticky top-0 z-50 w-full min-w-0 max-w-full border-b border-line bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex w-full min-w-0 max-w-[1440px] items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8">
          <BrandHomeLink showDescriptor />
          <label className="relative ml-auto hidden min-w-0 w-full max-w-xl md:block">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-line bg-surface-muted py-2.5 pl-10 pr-4 text-sm font-medium outline-none transition focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted"
              placeholder="궁금한 질문을 찾아보세요"
            />
          </label>
          <Link href="/create" className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-3 text-sm font-bold text-white transition-colors hover:bg-primary-hover md:ml-0 sm:px-4">
            <span className="sm:hidden">+ 질문</span>
            <span className="hidden sm:inline">+ 질문 올리기</span>
          </Link>
          <AuthButton />
          <ThemeToggle />
        </div>
        <div className="w-full min-w-0 max-w-full px-4 pb-3 md:hidden">
          <label className="relative block min-w-0 max-w-full">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-line bg-surface-muted py-2.5 pl-10 pr-4 text-sm font-medium outline-none focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted"
              placeholder="질문 검색"
            />
          </label>
        </div>
      </nav>

      <main className="mx-auto w-full min-w-0 max-w-[1440px] space-y-12 px-4 py-6 sm:px-6 md:space-y-16 md:py-10 lg:px-8">
        <div className="space-y-4 md:space-y-6">
          <section aria-labelledby="category-heading" className="min-w-0 max-w-full">
            <h2 id="category-heading" className="sr-only">주제별로 둘러보기</h2>
            <div className="relative min-w-0 max-w-full overflow-hidden">
              <div aria-label="질문 카테고리" className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto p-1 pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:pr-1">
                {categories.map((category) => {
                  const isActive = activeCategory === category;
                  const display = categoryDisplay[category];
                  const isDataCategory = category === '데이터';
                  return (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setActiveCategory(category)}
                      aria-pressed={isActive}
                      aria-controls="latest-polls"
                      aria-label={`${display.label}: ${display.description}`}
                      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas ${isActive ? 'border-primary bg-primary text-white shadow-sm' : isDataCategory ? 'border-dashed border-line bg-transparent text-muted hover:border-link hover:text-link dark:border-line dark:text-muted' : 'border-line bg-surface text-ink hover:border-link hover:text-link dark:border-line dark:bg-surface-muted dark:text-muted'}`}
                    >
                      <span aria-hidden="true" className="w-3 text-center text-xs">{isActive ? '✓' : null}</span>
                      {display.label}
                    </button>
                  );
                })}
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-canvas via-canvas/95 to-transparent md:hidden" />
            </div>
          </section>
          <section className="relative min-w-0 max-w-full overflow-hidden rounded-3xl border border-line bg-hero p-5 md:p-8 lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)] lg:items-start lg:gap-x-8 lg:gap-y-5">
            {featuredBattle ? (
              <>
                <div className="relative min-w-0 lg:col-start-1 lg:row-start-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-blue-500/20 bg-primary-soft px-3 py-1 text-xs font-black text-link dark:text-link">
                      {featuredBattle.participants > 0 ? `${BRAND.name} 오늘의 질문` : `${BRAND.name} · 첫 선택을 기다려요`}
                    </span>
                    <span className="text-xs font-bold text-muted dark:text-muted">{featuredBattle.category}</span>
                  </div>
                  <h1 className="mt-3 min-w-0 break-words text-3xl font-black leading-[1.1] tracking-[-0.04em] text-ink dark:text-ink sm:text-4xl md:text-5xl">
                    {featuredBattle.title}
                  </h1>
                  <p className="mt-2 text-xs font-medium text-muted dark:text-muted sm:text-sm">
                    {BRAND.tagline}
                  </p>
                </div>

                <div className="relative mt-4 min-w-0 max-w-full lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:pt-10">
                  <PollOptionImagePreview poll={featuredBattle} variant="hero" eager />
                  {featuredBattle.options.length === 2 ? (
                    <div className="relative grid grid-cols-2 gap-3">
                      {featuredBattle.options.map((option, index) => (
                        <div key={`${featuredBattle.id}_${index}`} className="flex min-h-20 min-w-0 items-center justify-center rounded-2xl border border-link/20 bg-primary-soft px-3 py-2 shadow-sm shadow-ink/[0.03]">
                          <div className="inline-flex min-w-0 max-w-full items-center gap-2">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-extrabold text-white md:size-8 md:text-sm">{index + 1}</span>
                            <span className="min-w-0 break-words text-left text-base font-bold leading-5 tracking-tight text-ink sm:text-lg sm:leading-6 md:text-xl">{option}</span>
                          </div>
                        </div>
                      ))}
                      <span aria-hidden="true" className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-xs font-bold tracking-wider text-muted dark:border-line dark:bg-surface-muted dark:text-muted">VS</span>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {featuredBattle.options.slice(0, 4).map((option, index) => (
                        <div key={`${featuredBattle.id}_${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-sm font-bold dark:border-line dark:bg-surface-muted">
                          <span className="text-link dark:text-link">{index + 1}</span>
                          <span className="min-w-0 break-words">{option}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-center text-xs font-medium text-muted dark:text-muted">결과는 선택하기 전까지 보이지 않아요.</p>
                </div>

                <div className="relative mt-4 min-w-0 lg:col-start-1 lg:row-start-2 lg:mt-0">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <Link
                      href={`/vote/${featuredBattle.id}`}
                      onClick={() => trackPollCardClicked({
                        poll_id: featuredBattle.id,
                        section: 'hero',
                        category: featuredBattle.analyticsCategory,
                        position: 0,
                      })}
                      className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-black text-white shadow-sm shadow-primary/20 transition hover:bg-primary-hover hover:shadow-md"
                    >
                      골라보고 결과 보기 →
                    </Link>
                    <Link href="/create" className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 text-sm font-bold transition hover:border-link dark:border-line dark:bg-surface-muted">
                      직접 물어보기
                    </Link>
                  </div>
                  <p className="mt-2 text-xs font-medium text-muted dark:text-muted">
                    현재 {featuredBattle.participants.toLocaleString()}명이 선택했어요.
                  </p>
                </div>
              </>
            ) : (
              <div className="relative py-8 lg:col-span-2 lg:text-center">
                <p className="text-xl font-bold text-ink dark:text-ink">지금 참여할 수 있는 질문을 기다리고 있어요.</p>
                <Link href="/create" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-black text-white">첫 질문 올리기 →</Link>
              </div>
            )}
          </section>
        </div>

        {loading || popularPolls.length > 0 ? (
        <section id="popular-polls" className="scroll-mt-32 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">실시간 인기</h2>
              <p className="mt-2 text-sm text-muted dark:text-muted">참여자 수와 접전 여부, 최신성을 함께 반영했어요.</p>
            </div>
            <Link href="/create" className="inline-flex min-h-11 items-center text-sm font-bold text-link hover:text-link dark:text-link">+ 질문 올리기</Link>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-muted">인기 투표를 불러오는 중...</div>
          ) : (
            <div className="grid min-w-0 max-w-full items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
              {popularPolls.map((poll, index) => (
                <Link
                  key={poll.id}
                  href={`/vote/${poll.id}`}
                  onClick={() => trackPollCardClicked({
                    poll_id: poll.id,
                    section: 'popular',
                    category: poll.category || '커뮤니티',
                    position: index,
                  })}
                  className="group flex min-w-0 max-w-full flex-col rounded-2xl border border-line/70 bg-surface p-4 shadow-sm shadow-ink/[0.04] transition hover:-translate-y-0.5 hover:border-link/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas md:h-full"
                >
                  <h3 className="line-clamp-2 min-w-0 break-words text-xl font-bold leading-7 text-ink md:min-h-14">{poll.title}</h3>
                  <p className="mt-1 text-xs font-bold text-link">{getInterestCategory(poll)}</p>
                  <PollChoiceRail poll={poll} />
                  <div className="mt-auto">
                    <PollCommunitySignals poll={poll} />
                    <div className="mt-2 flex min-h-11 items-center justify-end border-t border-line/60 pt-2 text-sm">
                      <span className="inline-flex items-center gap-2 font-extrabold text-link underline-offset-4 group-hover:underline"><span>결과 보기</span><span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        ) : null}

        {loading || risingPolls.length > 0 ? (
        <section className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">지금 뜨는 투표</h2>
            <p className="mt-2 text-sm text-muted dark:text-muted">최근 등록된 투표의 참여도와 접전 여부를 기준으로 정렬했어요.</p>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-muted">급상승 투표를 불러오는 중...</div>
          ) : (
            <div className="grid min-w-0 max-w-full gap-4 lg:grid-cols-2">
              {risingPolls.map((poll, index) => (
                <Link
                  key={poll.id}
                  href={`/vote/${poll.id}`}
                  onClick={() => trackPollCardClicked({
                    poll_id: poll.id,
                    section: 'rising',
                    category: poll.category || '커뮤니티',
                    position: index,
                  })}
                  className="group flex w-full min-w-0 max-w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition hover:border-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:border-line dark:bg-surface dark:focus-visible:ring-offset-canvas"
                >
                  <PollOptionImagePreview
                    poll={poll}
                    variant="compact"
                    badge={String(index + 1)}
                    fallback={<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-lg font-black text-link dark:text-link">{index + 1}</span>}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="min-w-0 break-words whitespace-normal text-base font-bold leading-snug text-ink dark:text-ink">{poll.title}</h3>
                    <div className="mt-2"><PollChoiceHint options={poll.options} /></div>
                    <PollCommunitySignals poll={poll} />
                    <p className="mt-2 text-xs font-medium text-link dark:text-link">{getInterestCategory(poll)}</p>
                  </div>
                  <span className="shrink-0 text-link transition-transform group-hover:translate-x-1">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        ) : null}

        <section id="latest-polls" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{latestSectionTitle}</h2>
              <p className="mt-2 text-sm text-muted dark:text-muted">{latestSectionDescription}</p>
            </div>
          </div>
          <div aria-live="polite" className="flex min-w-0 items-start gap-3 border-y border-line py-3 sm:items-center sm:gap-4">
            <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent sm:mt-0" />
            <div className="min-w-0 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-5 sm:gap-y-1">
              <p className="text-base font-bold text-ink">{activeCategoryDisplay.intro}</p>
              <p className="mt-1 break-words text-sm leading-5 text-muted sm:mt-0">{activeCategoryDisplay.examples.join(' · ')}</p>
            </div>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-muted">최신 투표를 불러오는 중...</div>
          ) : latestPolls.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted dark:border-line dark:bg-surface dark:text-muted">
              <p className="font-bold text-ink dark:text-ink">
                {filteredCommunityPolls.length === 0 ? emptyLatestTitle : '이 주제의 질문은 위에서 모두 소개했어요.'}
              </p>
              <p className="mt-1.5">궁금한 걸 먼저 물어볼까요?</p>
              <Link href="/create" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-blue-500/30 px-4 font-bold text-link transition hover:border-link hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:text-link dark:hover:bg-primary-soft dark:focus-visible:ring-offset-canvas">
                질문 올리기
              </Link>
            </div>
          ) : (
            <div className="grid min-w-0 max-w-full items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {latestPolls.map((poll, index) => (
                <Link
                  key={poll.id}
                  href={`/vote/${poll.id}`}
                  onClick={() => trackPollCardClicked({
                    poll_id: poll.id,
                    section: 'latest',
                    category: poll.category || '커뮤니티',
                    position: index,
                  })}
                  className="group flex min-w-0 max-w-full flex-col rounded-[1.5rem] border border-line/70 bg-surface p-4 shadow-sm shadow-ink/[0.04] transition hover:-translate-y-0.5 hover:border-link/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas md:h-full"
                >
                  <h3 className="line-clamp-2 min-w-0 break-words text-lg font-bold leading-6 text-ink md:min-h-12">{poll.title}</h3>
                  <p className="mt-1 text-xs font-bold text-link">{getInterestCategory(poll)}</p>
                  <PollChoiceRail poll={poll} />
                  <div className="mt-auto">
                    <PollCommunitySignals poll={poll} showCreatedAt />
                    <div className="mt-2 flex min-h-11 items-center justify-end border-t border-line/60 pt-2 text-sm">
                      <span className="inline-flex items-center gap-2 font-extrabold text-link underline-offset-4 group-hover:underline"><span>투표하러 가기</span><span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="official-intel-feed" className="space-y-4 border-t border-line pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold tracking-tight md:text-xl">데이터로 보는 세상</h2>
              <p className="mt-1 text-sm text-muted">질문 뒤의 흐름은 공식 통계로 살펴보세요.</p>
            </div>
            <span className="text-xs font-medium text-muted">공식 출처 기반</span>
          </div>
          {statsLoading ? (
            <div className="text-sm font-bold text-muted">공식 통계를 불러오는 중...</div>
          ) : filteredOfficialStats.length === 0 ? (
            <div className="py-4 text-sm text-muted">
              검색과 관심사 조건에 맞는 공식 통계가 없어요.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredOfficialStats.slice(0, 6).map((item) => {
                const latestValue = readLatestValue(item);
                const latestYear = readLatestYear(item);
                const opened = openStatId === item.id;
                return (
                  <article key={item.id} className="min-w-0 border-t border-line py-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">{item.category}</span>
                      <span className="text-xs font-medium text-muted dark:text-muted">{latestYear ? `최근 ${latestYear}` : item.published_at ?? item.observed_at ?? '최근 공개'}</span>
                    </div>
                    <h3 className="mt-2 text-base font-bold leading-snug text-ink">{item.title}</h3>
                    {latestValue !== null ? (
                      <p className="mt-2 text-xl font-bold text-ink">{formatStatValue(item, latestValue)}</p>
                    ) : null}
                    {item.summary ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{item.summary}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenStatId(opened ? null : item.id)}
                        className="min-h-11 rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-muted hover:border-link hover:text-ink"
                      >
                        {opened ? '접기' : '요약 보기'}
                      </button>
                      <Link href={`/stats/${item.id}`} className="inline-flex min-h-11 items-center rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-muted hover:text-ink">
                        관련 데이터 보기
                      </Link>
                    </div>
                    {opened ? (
                      <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
                        {item.methodology ? <p className="text-xs text-ink dark:text-muted"><span className="font-black">방법론:</span> {item.methodology}</p> : null}
                        {item.confidence_note ? <p className="text-xs text-ink dark:text-muted"><span className="font-black">신뢰 참고:</span> {item.confidence_note}</p> : null}
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
