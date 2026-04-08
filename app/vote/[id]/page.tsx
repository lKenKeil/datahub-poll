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

  useEffect(() => {
    const fetchAllData = async () => {
      const { data: poll } = await supabase.from('polls').select('*').eq('id', id).single();
      
      if (poll) {
        setPollData(poll);
        setIsOfficial(false);
        const total = poll.votes.reduce((a: number, b: number) => a + b, 0);
        if (total > 0) {
          setBarWidths(poll.votes.map((v: number) => Math.round((v / total) * 100)));
        }
      } else {
        const official = POLLS.find(p => p.id === id);
        if (official) {
          setPollData(official);
          setIsOfficial(true);
        }
      }

      const { data: dbComments } = await supabase.from('comments').select('*').eq('poll_id', id).order('created_at', { ascending: false });
      if (dbComments) setComments(dbComments);
    };
    fetchAllData();
  }, [id]);

  if (!pollData) return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold italic text-xl">ANALYZING DATA HUB...</div>;

  const handleVote = async (idx: number) => {
    const newVotes = [...(pollData.votes || pollData.options.map(() => 0))];
    newVotes[idx] += 1;
    const total = newVotes.reduce((a: number, b: number) => a + b, 0);
    const newStats = newVotes.map((v: number) => Math.round((v / total) * 100));

    setChoice(pollData.options[idx]);
    setVoted(true);
    setTimeout(() => setBarWidths(newStats), 100);

    await supabase.from('polls').upsert({
      id: id,
      title: pollData.title,
      category: pollData.category || 'GENERAL',
      options: pollData.options,
      votes: newVotes,
      participants: (pollData.participants || 0) + 1
    });
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    await supabase.from('polls').upsert({
      id: id,
      title: pollData.title,
      options: pollData.options,
      votes: pollData.votes || pollData.options.map(() => 0),
      participants: pollData.participants || 0,
      category: pollData.category || 'GENERAL'
    });

    const { data, error } = await supabase.from('comments').insert({
      poll_id: id,
      text: inputText,
      user_name: '익명 유저'
    }).select();

    if (error) {
      alert("댓글 등록 실패: " + error.message);
    } else if (data) {
      setComments([data[0], ...comments]);
      setInputText('');
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 pb-32">
      <nav className="border-b border-white/5 bg-[#020617]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-black text-slate-500 hover:text-white transition-colors tracking-tighter">
            ← BACK TO DATA CENTER
          </Link>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${isOfficial ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {isOfficial ? 'VERIFIED SOURCE' : 'COMMUNITY LIVE'}
            </span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 space-y-12">
        <header className="space-y-6 text-center">
          <span className="text-blue-500 font-black tracking-[0.2em] text-[10px] uppercase opacity-80">{pollData.category || 'GENERAL REPORT'}</span>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight break-keep">
            {pollData.title}
          </h1>
          <div className="flex justify-center items-center gap-6 text-slate-500 text-xs font-black tracking-widest">
            <span>SAMPLES: N={pollData.participants?.toLocaleString()}</span>
            <span className="w-1 h-1 bg-slate-800 rounded-full"></span>
            <span>STATUS: {voted ? 'CLOSED' : 'COLLECTING'}</span>
          </div>
        </header>

        <section className="relative">
          {!voted ? (
            <div className="grid gap-4">
              {pollData.options.map((opt: string, i: number) => (
                <button key={i} onClick={() => handleVote(i)} className="group w-full p-6 text-left bg-white/5 border border-white/10 rounded-2xl hover:border-blue-500/50 hover:bg-white/10 transition-all duration-300">
                  <div className="flex justify-between items-center font-bold text-lg">
                    <span>{opt}</span>
                    <span className="opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity text-sm">VOTE →</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-10 space-y-8 shadow-2xl">
              <div className="flex justify-between items-end">
                <h3 className="text-xl font-black text-white italic tracking-tighter">DATA ANALYSIS</h3>
                <span className="text-blue-500 font-black text-xs">SELECTED: {choice}</span>
              </div>
              <div className="space-y-6">
                {pollData.options.map((opt: string, i: number) => (
                  <div key={i} className="space-y-3">
                    <div className="flex justify-between items-center font-bold">
                      <span className={choice === opt ? "text-blue-400" : "text-slate-500"}>{opt}</span>
                      <span className="text-xl text-white font-black">{barWidths[i] || 0}%</span>
                    </div>
                    <div className="relative w-full bg-white/5 h-4 rounded-full overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-600 to-indigo-500 h-full transition-all duration-1000 ease-out" style={{ width: `${barWidths[i] || 0}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="pt-16 space-y-8">
          <div className="flex items-center gap-4">
            <h3 className="text-2xl font-black text-white italic tracking-tighter text-blue-500">INSIGHTS</h3>
            <span className="text-slate-700 font-black text-xs">{comments.length} RESPONSES</span>
            <div className="h-px flex-1 bg-white/5"></div>
          </div>

          <form onSubmit={handleCommentSubmit} className="relative group">
            <input value={inputText} onChange={(e) => setInputText(e.target.value)} className="w-full bg-white/5 border border-white/10 p-5 pr-28 rounded-2xl focus:outline-none focus:border-blue-500 focus:bg-white/10 transition-all font-bold text-white placeholder:text-slate-700" placeholder="의견을 남겨주세요..." />
            <button type="submit" className="absolute right-2 top-2 bottom-2 px-6 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition-all text-xs">POST</button>
          </form>

          <div className="grid gap-4">
            {comments.map((c: any) => (
              <div key={c.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-blue-500 uppercase">GUEST_USER</span>
                  <span className="text-[10px] text-slate-700 font-bold">{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-300 font-bold leading-relaxed">{c.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}