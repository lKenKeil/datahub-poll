'use client';

import { useState, use, useEffect } from 'react';
import Link from 'next/link';
import { POLLS } from '../../../data/polls';

export default function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [voted, setVoted] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [barWidths, setBarWidths] = useState([0, 0]);

  const [comments, setComments] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [pollData, setPollData] = useState<any>(null);

  useEffect(() => {
    let found = POLLS.find((p) => p.id === id);
    if (!found) {
      const customPolls = JSON.parse(localStorage.getItem('custom_polls') || '[]');
      found = customPolls.find((p: any) => p.id === id);
    }
    setPollData(found);
  }, [id]);

  useEffect(() => {
    const savedComments = localStorage.getItem(`poll_comments_${id}`);
    if (savedComments) {
      setComments(JSON.parse(savedComments));
    } else {
      setComments([{ id: 1, text: "이건 진짜 고민되네 ㅋㅋㅋ", time: "조금 전" }]);
    }
  }, [id]);

  if (pollData === null) return null; 
  
  if (pollData === undefined) {
    return (
      <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="text-center space-y-8 animate-in fade-in duration-500">
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">🤔 존재하지 않는 투표입니다.</h2>
          <Link href="/" className="inline-block px-8 py-4 bg-slate-900 text-white rounded-full font-bold hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-500/30 transition-all active:scale-95">
            메인으로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  const handleVote = (idx: number) => {
    setChoice(pollData.options[idx]);
    setVoted(true);
    setTimeout(() => {
      setBarWidths(pollData.stats);
    }, 100);
  };

  const handleReset = () => {
    setVoted(false);
    setChoice(null);
    setBarWidths([0, 0]);
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const newComment = { id: Date.now(), text: inputText, time: "방금 전" };
    const updatedComments = [newComment, ...comments];
    setComments(updatedComments);
    localStorage.setItem(`poll_comments_${id}`, JSON.stringify(updatedComments));
    setInputText('');
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] font-sans selection:bg-blue-200 pb-32">
      
      {/* 💎 상단 네비게이션바 (뒤로가기) */}
      <nav className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl border-b border-slate-200/50 transition-all px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="inline-flex items-center text-sm font-bold text-slate-500 hover:text-blue-600 transition-colors">
            <span className="mr-2 text-lg">←</span> 목록으로
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 mt-12 space-y-12">
        
        {/* 💎 투표 타이틀 영역 */}
        <header className="space-y-4 animate-in slide-in-from-bottom-4 duration-700">
          <div className="inline-block px-3 py-1 bg-blue-100 text-blue-700 font-black text-xs rounded-full mb-2">
            HOT ISSUE
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter leading-tight text-slate-900 break-keep">
            {pollData.title}
          </h1>
        </header>

        {/* 💎 투표 진행 영역 */}
        {!voted ? (
          <div className="space-y-4">
            {pollData.options.map((opt: string, i: number) => (
              <button
                key={i}
                onClick={() => handleVote(i)}
                className="w-full p-8 text-left bg-white border border-slate-200 rounded-[2rem] text-2xl font-bold text-slate-700 shadow-sm hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/10 hover:-translate-y-1 transition-all active:scale-95 group flex justify-between items-center"
              >
                <span>{opt}</span>
                <span className="w-8 h-8 rounded-full border-2 border-slate-200 group-hover:border-blue-500 transition-colors"></span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            
            {/* 💎 프리미엄 결과 통계 뷰 */}
            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50">
              <h3 className="text-xl font-black mb-8 text-slate-800 flex items-center gap-2">
                📊 실시간 투표 결과
              </h3>
              <div className="space-y-8">
                {pollData.options.map((opt: string, i: number) => (
                  <div key={i} className="relative">
                    <div className="flex justify-between mb-3 font-bold text-lg">
                      <span className={choice === opt ? "text-blue-600" : "text-slate-600"}>
                        {opt} {choice === opt && "✓"}
                      </span>
                      <span className={choice === opt ? "text-blue-600" : "text-slate-600"}>{pollData.stats[i]}%</span>
                    </div>
                    {/* 게이지 바 */}
                    <div className="w-full bg-slate-100 h-6 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${choice === opt ? 'bg-gradient-to-r from-blue-500 to-indigo-500' : 'bg-slate-300'}`}
                        style={{ width: `${barWidths[i]}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 💎 오피셜 팩트 카드 */}
            <div className="p-10 bg-slate-900 rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -mr-20 -mt-20"></div>
              <h3 className="text-sm font-black mb-4 text-blue-400 tracking-widest">OFFICIAL FACT</h3>
              <p className="text-xl font-medium leading-relaxed break-keep relative z-10 text-slate-100">
                "{pollData.officialFact}"
              </p>
            </div>

            {/* 재투표 버튼 */}
            <button onClick={handleReset} className="w-full py-5 bg-white border border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 transition-colors text-lg">
              ↺ 마음이 바뀌었어요 (다시 투표하기)
            </button>
          </div>
        )}

        {/* 💎 댓글 섹션 (Glassmorphism & 모던 UI) */}
        <div className="pt-16 mt-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-black text-slate-900">의견 남기기</h3>
            <span className="bg-slate-200 text-slate-600 text-sm font-bold px-3 py-1 rounded-full">{comments.length}개의 의견</span>
          </div>
          
          <form onSubmit={handleCommentSubmit} className="flex gap-3 mb-12">
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="당신의 생각을 자유롭게 적어주세요." 
              className="flex-1 px-6 py-4 rounded-2xl border-2 border-slate-200 bg-white focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all font-medium text-lg placeholder:text-slate-400"
            />
            <button 
              type="submit" 
              className="px-8 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30 active:scale-95 whitespace-nowrap"
            >
              등록
            </button>
          </form>

          {/* 댓글 리스트 */}
          <div className="space-y-4">
            {comments.map((comment) => (
              <div key={comment.id} className="p-6 bg-white rounded-[1.5rem] border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-200 to-slate-300"></div>
                  <span className="font-bold text-slate-800 text-sm">익명 유저</span>
                  <span className="text-xs font-semibold text-slate-400 ml-auto">{comment.time}</span>
                </div>
                <p className="text-lg font-medium text-slate-700 break-all leading-snug pl-11">{comment.text}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}