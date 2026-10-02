'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BrandWordmark } from '@/components/brand-wordmark';
import { ThemeToggle } from '@/components/theme-toggle';
import { BRAND } from '@/lib/brand';
import { trackPollCardClicked } from '@/lib/analytics';
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

const categoryDisplay: Record<HomeCategory, { label: string; description: string; intro: string }> = {
  '전체': {
    label: '전체',
    description: '정답은 없지만 자꾸 궁금해지는 질문들',
    intro: '사람들은 이런 걸 궁금해했어요.',
  },
  '연애/관계': {
    label: '연애·관계',
    description: '사람 사이엔 늘 궁금한 게 많아요',
    intro: '연애·관계에서 사람들이 궁금해한 것들',
  },
  '게임': {
    label: '게임',
    description: '게이머들은 은근 많이 갈려요',
    intro: '게임에서 의견이 갈린 질문들',
  },
  '스포츠': {
    label: '스포츠',
    description: '응원과 플레이 취향을 나눠보세요',
    intro: '스포츠를 즐기는 사람들의 선택',
  },
  '음식': {
    label: '음식',
    description: '먹는 취향은 생각보다 잘 갈려요',
    intro: '음식 취향이 갈린 질문들',
  },
  '엔터/콘텐츠': {
    label: '엔터·콘텐츠',
    description: '보고 듣는 취향은 저마다 달라요',
    intro: '콘텐츠 취향을 묻는 질문들',
  },
  'IT/제품': {
    label: 'IT·제품',
    description: '매일 쓰는 제품일수록 선택이 갈려요',
    intro: '기술과 제품을 고르는 사람들의 기준',
  },
  '라이프': {
    label: '라이프',
    description: '사소하지만 은근 궁금한 것들',
    intro: '일상에서 문득 궁금해진 질문들',
  },
  '가치관': {
    label: '가치관',
    description: '정답은 없지만 생각은 갈리는 질문',
    intro: '서로 다른 생각을 확인하는 질문들',
  },
  '데이터': {
    label: '데이터',
    description: '선택 뒤의 흐름도 함께 살펴봐요',
    intro: '데이터로 확인해보는 질문과 흐름',
  },
};

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
  variant: 'hero' | 'card' | 'compact';
  eager?: boolean;
  badge?: string;
  fallback?: ReactNode;
}) {
  const imageUrls = getPollPreviewImageUrls(poll);
  if (imageUrls.length === 0) return fallback;

  const containerClass = variant === 'hero'
    ? 'mt-5 aspect-[16/7] w-full rounded-2xl'
    : variant === 'card'
      ? 'mt-4 h-24 w-full rounded-2xl'
      : 'h-20 w-24 shrink-0 rounded-2xl sm:w-28';
  const imageSizes = variant === 'hero'
    ? imageUrls.length > 1
      ? '(max-width: 1024px) 45vw, 280px'
      : '(max-width: 1024px) calc(100vw - 80px), 560px'
    : variant === 'card'
      ? imageUrls.length > 1
        ? '(max-width: 768px) 45vw, (max-width: 1280px) 22vw, 14vw'
        : '(max-width: 768px) calc(100vw - 72px), (max-width: 1280px) 45vw, 28vw'
      : '112px';

  return (
    <div
      aria-hidden="true"
      className={`relative grid min-w-0 grid-flow-col overflow-hidden bg-slate-200 dark:bg-slate-900 ${imageUrls.length > 1 ? 'grid-cols-2 gap-px' : 'grid-cols-1'} ${containerClass}`}
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
        <span className="absolute left-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-lg bg-cyan-600/90 px-2 text-xs font-black text-white shadow-sm">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function PollChoiceHint({ options }: { options: string[] }) {
  if (options.length < 2) return null;

  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(0,1fr)] items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300">1</span>
      <span className="truncate">{options[0]}</span>
      <span className="text-[10px] font-black tracking-wider text-slate-400">VS</span>
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">2</span>
      <span className="truncate">{options[1]}</span>
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
    <div aria-label="활동 정보" className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {signals.map((signal, index) => (
        <span key={`${signal.label}-${index}`} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 ? <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span> : null}
          <span className={signal.emphasized ? 'font-bold text-violet-700 dark:text-violet-300' : 'font-medium text-slate-600 dark:text-slate-400'}>
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
    return rankedActiveCommunityPolls
      .filter((poll) => poll.id !== featuredCommunityPoll?.id)
      .slice(0, 6);
  }, [featuredCommunityPoll?.id, rankedActiveCommunityPolls]);

  const risingPolls = useMemo(() => {
    const shownIds = new Set([
      ...(featuredCommunityPoll ? [featuredCommunityPoll.id] : []),
      ...popularPolls.map((poll) => poll.id),
    ]);
    return filteredCommunityPolls
      .filter((poll) => (
        (poll.participants ?? 0) > 0
        && isFreshPoll(poll)
        && !shownIds.has(poll.id)
      ))
      .sort(compareByRisingScore)
      .slice(0, 4);
  }, [featuredCommunityPoll, filteredCommunityPolls, popularPolls]);

  const latestPolls = useMemo(() => {
    const shownIds = new Set([
      ...(featuredCommunityPoll ? [featuredCommunityPoll.id] : []),
      ...popularPolls.map((poll) => poll.id),
      ...risingPolls.map((poll) => poll.id),
    ]);
    return latestCommunityPolls
      .filter((poll) => !shownIds.has(poll.id))
      .slice(0, 8);
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
    <div className="min-h-screen w-full min-w-0 max-w-full bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 selection:bg-blue-500/30">
      <nav className="sticky top-0 z-50 w-full min-w-0 max-w-full border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-white/5 dark:bg-[#020617]/80">
        <div className="mx-auto flex w-full min-w-0 max-w-[1440px] items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 lg:px-8">
          <Link href="/" aria-label={`${BRAND.name} 홈`} className="flex min-h-11 shrink-0 items-center">
            <BrandWordmark />
          </Link>
          <label className="relative ml-auto hidden min-w-0 w-full max-w-xl md:block">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-100/80 py-2.5 pl-10 pr-4 text-sm font-medium outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5"
              placeholder="궁금한 질문을 찾아보세요"
            />
          </label>
          <Link href="/create" className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 px-3 text-sm font-bold text-white transition-colors hover:bg-blue-600 hover:text-white dark:bg-white dark:text-black md:ml-0 sm:px-4">
            <span className="sm:hidden">+ 질문</span>
            <span className="hidden sm:inline">+ 질문 올리기</span>
          </Link>
          <ThemeToggle />
        </div>
        <div className="w-full min-w-0 max-w-full px-4 pb-3 md:hidden">
          <label className="relative block min-w-0 max-w-full">
            <span className="sr-only">투표 검색</span>
            <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="min-h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-100 py-2.5 pl-10 pr-4 text-sm font-medium outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5"
              placeholder="질문 검색"
            />
          </label>
        </div>
      </nav>

      <main className="mx-auto w-full min-w-0 max-w-[1440px] space-y-12 px-4 py-6 sm:px-6 md:space-y-16 md:py-10 lg:px-8">
        <section className="relative min-w-0 max-w-full overflow-hidden rounded-3xl border border-blue-200/70 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-5 shadow-[0_24px_80px_-48px_rgba(37,99,235,0.65)] dark:border-blue-500/20 dark:from-slate-900 dark:via-[#07152f] dark:to-[#052631] md:p-8 lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)] lg:items-center lg:gap-10">
          <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
          {featuredBattle ? (
            <>
              <div className="relative min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-700 dark:text-blue-300">
                    {featuredBattle.participants > 0 ? '오늘의 질문' : '첫 선택을 기다려요'}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{featuredBattle.category}</span>
                </div>
                <h1 className="mt-4 min-w-0 break-words text-3xl font-black leading-[1.1] tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl md:text-5xl">
                  {featuredBattle.title}
                </h1>
                <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-300 sm:text-base">
                  {BRAND.tagline}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/vote/${featuredBattle.id}`}
                    onClick={() => trackPollCardClicked({
                      poll_id: featuredBattle.id,
                      section: 'hero',
                      category: featuredBattle.analyticsCategory,
                      position: 0,
                    })}
                    className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
                  >
                    결과가 궁금하다면 골라보기 →
                  </Link>
                  <Link href="/create" className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white/70 px-5 text-sm font-bold transition hover:border-blue-500 dark:border-white/15 dark:bg-white/5">
                    직접 물어보기
                  </Link>
                </div>
                <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
                  현재 {featuredBattle.participants.toLocaleString()}명이 선택했어요.
                </p>
              </div>

              <div className="relative mt-6 min-w-0 max-w-full rounded-2xl border border-white/70 bg-white/90 p-4 shadow-xl shadow-blue-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/65 md:p-6 lg:mt-0">
                <PollOptionImagePreview poll={featuredBattle} variant="hero" eager />
                {featuredBattle.options.length === 2 ? (
                  <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
                    {featuredBattle.options.map((option, index) => (
                      <div key={`${featuredBattle.id}_${index}`} className="flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${index === 0 ? 'bg-blue-600 text-white' : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'}`}>{index + 1}</span>
                        <span className="min-w-0 break-words text-base font-bold text-slate-900 dark:text-white">{option}</span>
                      </div>
                    ))}
                    <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-black tracking-wider text-slate-500 shadow-sm dark:border-white/15 dark:bg-slate-900 dark:text-slate-300">VS</span>
                  </div>
                ) : (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {featuredBattle.options.slice(0, 4).map((option, index) => (
                      <div key={`${featuredBattle.id}_${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold dark:border-white/10 dark:bg-white/5">
                        <span className="text-blue-600 dark:text-blue-300">{index + 1}</span>
                        <span className="min-w-0 break-words">{option}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-4 text-center text-xs font-medium text-slate-500 dark:text-slate-400">결과는 선택하기 전까지 보이지 않아요.</p>
              </div>
            </>
          ) : (
            <div className="relative py-8 lg:col-span-2 lg:text-center">
              <p className="text-xl font-bold text-slate-900 dark:text-white">지금 참여할 수 있는 질문을 기다리고 있어요.</p>
              <Link href="/create" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 text-sm font-black text-white">첫 질문 올리기 →</Link>
            </div>
          )}
        </section>

        {loading || popularPolls.length > 0 ? (
        <section id="popular-polls" className="scroll-mt-32 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">실시간 인기</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">참여자 수와 접전 여부, 최신성을 함께 반영했어요.</p>
            </div>
            <Link href="/create" className="inline-flex min-h-11 items-center text-sm font-bold text-blue-600 hover:text-blue-500 dark:text-blue-300">+ 질문 올리기</Link>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">인기 투표를 불러오는 중...</div>
          ) : (
            <div className="grid min-w-0 max-w-full items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                  className="group flex min-h-52 min-w-0 max-w-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-1 hover:border-blue-400 hover:shadow-xl hover:shadow-blue-950/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-blue-400/50 dark:focus-visible:ring-offset-slate-950"
                >
                  <h3 className="min-w-0 break-words text-xl font-bold leading-snug text-slate-950 dark:text-white">{poll.title}</h3>
                  <p className="mt-2 text-xs font-bold text-blue-600 dark:text-cyan-300">{getInterestCategory(poll)}</p>
                  <PollOptionImagePreview poll={poll} variant="card" />
                  <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.035]">
                    <PollChoiceHint options={poll.options} />
                  </div>
                  <PollCommunitySignals poll={poll} />
                  <div className="mt-auto flex items-center justify-end border-t border-slate-100 pt-5 text-sm dark:border-white/10">
                    <span className="font-bold text-blue-600 transition-transform group-hover:translate-x-1 dark:text-blue-300">결과 보기 →</span>
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
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">최근 등록된 투표의 참여도와 접전 여부를 기준으로 정렬했어요.</p>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">급상승 투표를 불러오는 중...</div>
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
                  className="group flex w-full min-w-0 max-w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-cyan-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.04] dark:focus-visible:ring-offset-slate-950"
                >
                  <PollOptionImagePreview
                    poll={poll}
                    variant="compact"
                    badge={String(index + 1)}
                    fallback={<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/10 text-lg font-black text-cyan-600 dark:text-cyan-300">{index + 1}</span>}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="min-w-0 break-words whitespace-normal text-base font-bold leading-snug text-slate-950 dark:text-white">{poll.title}</h3>
                    <div className="mt-2"><PollChoiceHint options={poll.options} /></div>
                    <PollCommunitySignals poll={poll} />
                    <p className="mt-2 text-xs font-medium text-blue-600 dark:text-cyan-300">{getInterestCategory(poll)}</p>
                  </div>
                  <span className="shrink-0 text-blue-500 transition-transform group-hover:translate-x-1">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        ) : null}

        <section aria-labelledby="category-heading" className="min-w-0 max-w-full space-y-4">
          <div>
            <h2 id="category-heading" className="text-2xl font-bold tracking-tight">주제별로 둘러보기</h2>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">뭐가 궁금해요? 다음 질문의 주제를 골라보세요.</p>
          </div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:items-center">
            <div className="relative min-w-0 max-w-full overflow-hidden">
              <div aria-label="질문 카테고리" className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-2 pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible md:pr-0">
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
                      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${isActive ? 'border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-600/20' : isDataCategory ? 'border-dashed border-slate-300 bg-transparent text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:border-white/20 dark:text-slate-400' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}
                    >
                      {isActive ? <span aria-hidden="true" className="text-xs">✓</span> : null}
                      {display.label}
                    </button>
                  );
                })}
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-50 via-slate-50/95 to-transparent dark:from-[#020617] dark:via-[#020617]/95 md:hidden" />
            </div>
            <div aria-live="polite" className="min-w-0 border-l-2 border-blue-500/30 pl-3">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{activeCategoryDisplay.intro}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{activeCategoryDisplay.description}</p>
            </div>
          </div>
        </section>

        <section id="latest-polls" className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{latestSectionTitle}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{latestSectionDescription}</p>
          </div>
          {loading ? (
            <div className="text-sm font-bold text-slate-500">최신 투표를 불러오는 중...</div>
          ) : latestPolls.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white/50 p-6 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
              <p className="font-bold text-slate-900 dark:text-white">
                {filteredCommunityPolls.length === 0 ? emptyLatestTitle : '이 주제의 질문은 위에서 모두 소개했어요.'}
              </p>
              <p className="mt-1.5">궁금한 걸 먼저 물어볼까요?</p>
              <Link href="/create" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-blue-500/30 px-4 font-bold text-blue-600 transition hover:border-blue-500 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-300 dark:hover:bg-blue-500/10 dark:focus-visible:ring-offset-slate-950">
                질문 올리기
              </Link>
            </div>
          ) : (
            <div className="grid min-w-0 max-w-full items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                  className="group flex min-w-0 max-w-full flex-col rounded-[1.5rem] border border-slate-200 bg-white p-5 transition hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-blue-500/[0.06] dark:focus-visible:ring-offset-slate-950"
                >
                  <h3 className="min-w-0 break-words text-lg font-bold leading-snug text-slate-950 dark:text-white">{poll.title}</h3>
                  <p className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-300">{getInterestCategory(poll)}</p>
                  <PollOptionImagePreview poll={poll} variant="card" />
                  <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.035]">
                    <PollChoiceHint options={poll.options} />
                  </div>
                  <PollCommunitySignals poll={poll} showCreatedAt />
                  <div className="mt-6 flex items-center justify-end border-t border-slate-100 pt-4 text-xs dark:border-white/10">
                    <span className="font-bold text-blue-600 transition-transform group-hover:translate-x-1 dark:text-blue-300">투표하러 가기 →</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="official-intel-feed" className="space-y-5 rounded-3xl border border-cyan-500/15 bg-gradient-to-br from-cyan-50/70 to-blue-50/40 p-5 dark:from-cyan-950/20 dark:to-blue-950/10 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">📊 데이터로 보는 세상</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">투표 뒤에 있는 흐름을 공식 통계로 확인해보세요.</p>
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
                  <article key={item.id} className="rounded-2xl border border-slate-200 bg-white/90 p-5 transition hover:border-cyan-500/50 dark:border-white/10 dark:bg-slate-950/55">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-700 dark:text-cyan-300">{item.category}</span>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{latestYear ? `최근 ${latestYear}` : item.published_at ?? item.observed_at ?? '최근 공개'}</span>
                    </div>
                    <h3 className="mt-4 text-lg font-bold leading-snug text-slate-950 dark:text-white">{item.title}</h3>
                    {latestValue !== null ? (
                      <p className="mt-3 text-2xl font-black text-cyan-600 dark:text-cyan-300">{formatStatValue(item, latestValue)}</p>
                    ) : null}
                    {item.summary ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{item.summary}</p> : null}
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => setOpenStatId(opened ? null : item.id)}
                        className="min-h-10 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold hover:border-cyan-500 dark:border-white/20"
                      >
                        {opened ? '접기' : '요약 보기'}
                      </button>
                      <Link href={`/stats/${item.id}`} className="inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
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
