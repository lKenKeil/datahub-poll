'use client';

import { useState, useEffect } from 'react';
import Link from "next/link";
import { POLLS } from "../data/polls";

export default function Home() {
  const [allPolls, setAllPolls] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('전체');

  const categories = ['전체', 'IT/테크', '사회/문화', '소비/경제', '라이프스타일'];

  useEffect(() => {
    // 임시로 기존 데이터에 카테고리를 부여합니다 (나중에 data/polls.ts에서 직접 관리하시면 됩니다)
    const formattedPolls = POLLS.map(p => ({
      ...p,
      category: p.id === 'phone' ? 'IT/테크' : '소비/경제'
    }));

    const customPolls = JSON.parse(localStorage.getItem('custom_polls') || '[]');
    setAllPolls([...customPolls, ...formattedPolls]);
  }, []);

  // 검색어와 카테고리에 맞게 데이터를 필터링하는 로직
  const filteredPolls = allPolls.filter(poll => {
    const matchSearch = poll.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCategory = activeCategory === '전체' || poll.category === activeCategory || (!poll.category && activeCategory === '기타');
    return matchSearch && matchCategory;
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans selection:bg-blue-200">
      
      {/* 💎 네비게이션 */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-200/50 transition-all">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <Link href="/" className="text-2xl font-black tracking-tighter text-slate-900">
            DATA<span className="text-blue-600">HUB.</span>
          </Link>
          <Link href="/create" className="px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-full hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all active:scale-95">
            찾는 통계가 없나요? 직접 설문하기
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-16">
        
        {/* 💎 검색 및 헤더 섹션 (전문적인 아카이브 느낌) */}
        <section className="text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="space-y-4">
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900">
              20대 트렌드 데이터 아카이브
            </h2>
            <p className="text-lg text-slate-500 font-medium">
              과제, 기획서, 공모전에 필요한 완벽한 통계 자료를 검색하세요.
            </p>
          </div>

          {/* 대형 검색창 */}
          <div className="max-w-2xl mx-auto relative group">
            <div className="absolute inset-y-0 left-0 pl-6 flex items-center pointer-events-none text-2xl">
              🔍
            </div>
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 py-5 bg-white border-2 border-slate-200 rounded-full text-lg font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-sm group-hover:shadow-md"
              placeholder="예: 대학생 아이폰 점유율, 첫차 구매 예산..."
            />
          </div>

          {/* 카테고리 필터 (Pill 디자인) */}
          <div className="flex flex-wrap justify-center gap-3 pt-4">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-6 py-2.5 rounded-full text-sm font-bold transition-all ${
                  activeCategory === cat 
                    ? 'bg-slate-900 text-white shadow-md' 
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </section>

        {/* 💎 데이터 리스트 그리드 */}
        <section>
          <div className="flex justify-between items-end mb-6">
            <h3 className="text-xl font-black text-slate-800">
              {searchTerm ? `'${searchTerm}' 검색 결과` : '🔥 실시간 인기 통계'}
            </h3>
            <span className="text-sm font-bold text-slate-500">총 {filteredPolls.length}개의 데이터</span>
          </div>

          {filteredPolls.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border border-slate-200 border-dashed">
              <p className="text-xl font-bold text-slate-400 mb-6">검색된 통계 자료가 없습니다.</p>
              <Link href="/create" className="px-8 py-4 bg-slate-900 text-white font-bold rounded-full hover:bg-slate-800 transition-colors">
                직접 설문조사 만들고 데이터 수집하기
              </Link>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPolls.map((v) => (
                <Link href={`/vote/${v.id}`} key={v.id} className="group outline-none">
                  <div className="h-full p-8 bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between">
                    
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <span className="bg-slate-100 text-slate-600 text-xs font-black px-3 py-1 rounded-md">
                          {v.category || '기타'}
                        </span>
                        {v.id.toString().startsWith('custom_') && (
                          <span className="text-blue-500 text-xs font-black">USER DATA</span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold leading-snug text-slate-800 group-hover:text-blue-600 transition-colors break-keep mb-6">
                        {v.title.replace('🔥 ', '')}
                      </h3>
                    </div>
                    
                    <div className="flex justify-between items-end pt-5 border-t border-slate-50">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sample Size</span>
                        <span className="text-slate-900 font-black text-lg">N={v.participants.toLocaleString()}</span>
                      </div>
                      <div className="text-blue-600 font-bold group-hover:translate-x-1 transition-transform">
                        자료 보기 →
                      </div>
                    </div>

                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}