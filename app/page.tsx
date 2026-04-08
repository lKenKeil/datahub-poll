'use client';

import { useState, useEffect } from 'react';
import Link from "next/link";
import { POLLS } from "../data/polls";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [dbPolls, setDbPolls] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('전체');

  const categories = ['전체', '학술/통계', 'IT/테크', '사회/경제', '라이프스타일', '커뮤니티'];

  useEffect(() => {
    async function fetchPolls() {
      // ☁️ Supabase에서 유저 생성 데이터 가져오기
      const { data, error } = await supabase
        .from('polls')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) console.error("데이터 로딩 실패:", error);
      setDbPolls(data || []);
    }
    fetchPolls();
  }, []);

  // 💎 필터링 로직 (검색 및 카테고리)
  const filterFn = (poll: any) => {
    const matchSearch = poll.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = activeCategory === '전체' || poll.category === activeCategory;
    return matchSearch && matchCategory;
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-blue-500/30">
      
      {/* 💎 글로벌 네비게이션 */}
      <nav className="sticky top-0 z-50 bg-[#020617]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-black tracking-tighter flex items-center gap-2">
            <span className="bg-blue-600 px-2 py-0.5 rounded text-white">DATA</span>
            <span className="text-white">HUB.</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/create" className="px-5 py-2 bg-white text-black text-sm font-bold rounded-full hover:bg-blue-500 hover:text-white transition-all">
              + 새 데이터 등록
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-16 space-y-24">
        
        {/* 💎 메인 헤드라인 (대표님 피드백 반영: 전 연령/학술/커뮤니티 통합) */}
        <section className="space-y-10 text-center">
          <div className="space-y-6">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-[1.1] text-white">
              세상의 모든 기준을<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-indigo-400 to-emerald-400">데이터로 아카이빙하다</span>
            </h1>
            <p className="text-slate-400 text-xl font-medium max-w-3xl mx-auto break-keep">
              학술적 가치가 있는 공공 통계부터 뜨거운 커뮤니티 이슈까지, <br />
              객관적인 수치로 증명된 실시간 데이터 통합 플랫폼입니다.
            </p>
          </div>

          {/* 🔍 검색 및 카테고리 */}
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="relative group">
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-8 py-6 bg-white/5 border border-white/10 rounded-3xl text-xl font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all shadow-2xl"
                placeholder="관심 있는 통계나 이슈를 검색하세요..."
              />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-6 py-2 rounded-full text-xs font-black tracking-wider uppercase transition-all ${
                    activeCategory === cat ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-500 border border-white/5 hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 💎 [SECTION 1] Official Fact (정적/학술적 통계 고정) */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-blue-500 font-black tracking-widest text-xs">OFFICIAL ARCHIVE</span>
            <div className="h-px flex-1 bg-blue-500/20"></div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-2 gap-6">
            {POLLS.filter(filterFn).map(p => (
              <Link href={`/vote/${p.id}`} key={p.id} className="group flex bg-gradient-to-br from-slate-900 to-[#020617] border border-blue-500/20 p-8 rounded-[2rem] hover:border-blue-500 transition-all">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-black rounded">VERIFIED</span>
                  </div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors">{p.title}</h3>
                  <p className="text-slate-500 text-sm">신뢰할 수 있는 소스로부터 수집된 공인 데이터입니다.</p>
                </div>
                <div className="flex flex-col justify-end text-right">
                  <span className="text-2xl font-black text-white">N={p.participants.toLocaleString()}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 💎 [SECTION 2] Live Community (갈드컵/실시간 유저 데이터) */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <span className="text-emerald-500 font-black tracking-widest text-xs">LIVE DISCUSSIONS</span>
            <div className="h-px flex-1 bg-emerald-500/20"></div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dbPolls.filter(filterFn).map(v => (
              <Link href={`/vote/${v.id}`} key={v.id} className="group p-8 bg-white/5 border border-white/10 rounded-[2rem] hover:bg-white/[0.07] transition-all">
                <div className="space-y-6">
                  <div className="flex justify-between items-start">
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-black rounded uppercase">{v.category || '커뮤니티'}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                      <span className="text-[10px] font-black text-blue-500 uppercase">Live</span>
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors leading-snug">{v.title}</h3>
                  <div className="pt-6 border-t border-white/5 flex justify-between items-center text-slate-500">
                    <span className="text-xs font-bold">Samples: {v.participants}</span>
                    <span className="text-xl group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}