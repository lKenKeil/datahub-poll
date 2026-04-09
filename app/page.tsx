'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { POLLS } from '../data/polls';
import { DbPoll, PollCategory } from '../lib/types';

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

export default function Home() {
  const [dbPolls, setDbPolls] = useState<DbPoll[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<'전체' | PollCategory>('전체');
  const [loading, setLoading] = useState(true);

  const officialIdSet = useMemo(() => new Set(POLLS.map((poll) => poll.id)), []);

  const trendingPolls = useMemo(() => {
    return [...dbPolls]
      .sort((a, b) => getTrendingScore(b) - getTrendingScore(a))
      .slice(0, 3);
  }, [dbPolls]);

  useEffect(() => {
    async function fetchPolls() {
      const response = await fetch('/api/polls', { cache: 'no-store' });
      const json = (await response.json()) as { data?: DbPoll[]; error?: string };

      if (!response.ok) {
        console.error('데이터 로딩 실패:', json.error ?? 'unknown error');
        setDbPolls([]);
        setLoading(false);
        return;
      }

      const rows = (json.data ?? []).filter((poll) => {
        return poll.id.startsWith('custom_') || !officialIdSet.has(poll.id.replace('official_', ''));
      });

      setDbPolls(rows);
      setLoading(false);
    }

    fetchPolls();
  }, [officialIdSet]);

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

        <section className="space-y-8">
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

        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-blue-500 font-black tracking-widest text-xs">OFFICIAL ARCHIVE</span>
            <div className="h-px flex-1 bg-blue-500/20"></div>
          </div>
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
        </section>

        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-emerald-500 font-black tracking-widest text-xs">LIVE DISCUSSIONS</span>
            <div className="h-px flex-1 bg-emerald-500/20"></div>
          </div>

          {loading ? (
            <div className="text-slate-500 text-sm font-bold">커뮤니티 데이터를 불러오는 중...</div>
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
