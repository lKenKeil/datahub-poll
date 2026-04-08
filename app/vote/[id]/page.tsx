'use client';

import { useState, use, useEffect } from 'react';
import Link from 'next/link';
import { POLLS } from '../../../data/polls';
import { supabase } from "@/lib/supabase";

export default function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const [voted, setVoted] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [barWidths, setBarWidths] = useState<number[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [pollData, setPollData] = useState<any>(null);
  const [isOfficial, setIsOfficial] = useState(false);

  // 1. 데이터 초기 로드
  useEffect(() => {
    const fetchAllData = async () => {
      // DB에서 투표 정보 조회
      const { data: poll } = await supabase.from('polls').select('*').eq('id', id).single();
      
      if (poll) {
        setPollData(poll);
        setIsOfficial(false);
      } else {
        // DB에 없으면 로컬 오피셜 데이터에서 찾음
        const official = POLLS.find(p => p.id === id);
        if (official) {
          setPollData(official);
          setIsOfficial(true);
        }
      }

      // 댓글 목록 로드
      const { data: dbComments } = await supabase
        .from('comments')
        .select('*')
        .eq('poll_id', id)
        .order('created_at', { ascending: false });

      if (dbComments) setComments(dbComments);
    };

    fetchAllData();
  }, [id]);

  if (!pollData) return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold">데이터 분석 중...</div>;

  // 2. 투표 처리
  const handleVote = async (idx: number) => {
    const selectedOption = pollData.options[idx];
    setChoice(selectedOption);
    setVoted(true);

    const newVotes = [...(pollData.votes || [0, 0])];
    newVotes[idx] += 1;
    const total = newVotes.reduce((a: number, b: number) => a + b, 0);
    const newStats = newVotes.map((v: number) => Math.round((v / total) * 100));

    setTimeout(() => setBarWidths(newStats), 100);

    // 오피셜 데이터건 DB 데이터건 투표하면 DB에 upsert(없으면 생성, 있으면 업데이트)
    await supabase.from('polls').upsert({
      id: pollData.id,
      title: pollData.title,
      category: pollData.category || '학술/통계',
      options: pollData.options,
      votes: newVotes,
      participants: (pollData.participants || 0) + 1
    });
  };

  // 3. 댓글 등록 처리 (오피셜 데이터 예외 처리 포함)
  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    // 만약 오피셜 데이터인데 아직 DB에 등록 안 된 경우를 위해 투표 데이터를 먼저 upsert
    // (댓글은 poll_id를 참조하므로 polls 테이블에 해당 id가 반드시 있어야 함)
    await supabase.from('polls').upsert({
      id: pollData.id,
      title: pollData.title,
      category: pollData.category || '학술/통계',
      options: pollData.options,
      votes: pollData.votes,
      participants: pollData.participants
    });

    // 이제 댓글 삽입
    const { data, error } = await supabase
      .from('comments')
      .insert([{
        poll_id: id,
        text: inputText,
        user_name: '익명 유저'
      }])
      .select();

    if (!error && data) {
      setComments([data[0], ...comments]);
      setInputText('');
    } else if (error) {
      alert("댓글 등록 실패: " + error.message);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 pb-32">
      <nav className="border-b border-white/5 bg-[#020617]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-black text-slate-500 hover:text-white transition-colors">
            ← BACK TO ARCHIVE
          </Link>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${isOfficial ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {isOfficial ? 'VERIFIED DATA' : 'LIVE COMMUNITY'}
            </span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 space-y-12">
        <header className="space-y-6 text-center">
          <span className="text-blue-500 font-black tracking-widest text-xs uppercase">{pollData.category || 'GENERAL'}</span>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight break-keep">
            {pollData.title}
          </h1>
          <div className="flex justify-center items-center gap-6 text-slate-500 text-sm font-bold">
            <span>SAMPLES: N={pollData.participants?.toLocaleString()}</span>
            <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
            <span>STATUS: ACTIVE</span>
          </div>
        </header>

        <section className="relative">
          {!voted ? (
            <div className="grid gap-4">
              {pollData.options.map((opt: string, i: number) => (
                <button 
                  key={i} 
                  onClick={() => handleVote(i)} 
                  className="group relative w-full p-6 text-left bg-white/5 border border-white/10 rounded-2xl hover:border-blue-500/50 hover:bg-white/10 transition-all duration-300"
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xl font-bold text-slate-300 group-hover:text-white transition-colors">{opt}</span>
                    <span className="opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity">VOTE →</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
              <div className="flex justify-between items-end">
                <h3 className="text-xl font-black text-white italic">REAL-TIME STATISTICS</h3>
                <span className="text-blue-500 font-bold text-sm">Your Choice: {choice}</span>
              </div>
              <div className="space-y-6">
                {pollData.options.map((opt: string, i: number) => (
                  <div key={i} className="space-y-3">
                    <div className="flex justify-between items-center font-bold">
                      <span className={choice === opt ? "text-blue-400" : "text-slate-400"}>{opt}</span>
                      <span className="text-xl text-white">{barWidths[i] || 0}%</span>
                    </div>
                    <div className="relative w-full bg-white/5 h-4 rounded-full overflow-hidden">
                      <div 
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-indigo-500 h-full transition-all duration-1000 ease-out" 
                        style={{ width: `${barWidths[i] || 0}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="pt-16 space-y-8">
          <div className="flex items-center gap-4">
            <h3 className="text-2xl font-black text-white italic">INSIGHTS</h3>
            <span className="text-slate-600 font-bold text-sm">{comments.length} COMMENTS</span>
            <div className="h-px flex-1 bg-white/5"></div>
          </div>

          <form onSubmit={handleCommentSubmit} className="relative group">
            <input 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-5 pr-28 rounded-2xl focus:outline-none focus:border-blue-500 focus:bg-white/10 transition-all font-medium text-white"
              placeholder="데이터 분석에 대한 의견을 공유하세요..."
            />
            <button type="submit" className="absolute right-2 top-2 bottom-2 px-6 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition-all">
              POST
            </button>
          </form>

          <div className="grid gap-4">
            {comments.map((c: any) => (
              <div key={c.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-blue-500 uppercase tracking-tighter">{c.user_name}</span>
                  <span className="text-[10px] text-slate-600">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-300 font-medium leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}