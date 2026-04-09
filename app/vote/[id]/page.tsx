'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { POLLS } from '../../../data/polls';
import { supabase } from '@/lib/supabase';
import { CommentRow, DbPoll } from '@/lib/types';

type VotePageParams = { id: string };

type ViewPoll = {
  id: string;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
  officialFact?: string;
};

type IncrementVoteResponse = {
  id: string;
  votes: number[];
  participants: number;
};

function statsToVotes(stats: number[], participants: number) {
  return stats.map((ratio) => Math.max(0, Math.round((participants * ratio) / 100)));
}

function calcPercentages(votes: number[]) {
  const total = votes.reduce((acc, curr) => acc + curr, 0);
  if (total === 0) return votes.map(() => 0);
  return votes.map((value) => Math.round((value / total) * 100));
}

function getReliability(participants: number) {
  if (participants >= 1000) {
    return { label: '신뢰도 높음', style: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
  }

  if (participants >= 300) {
    return { label: '신뢰도 보통', style: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
  }

  return { label: '신뢰도 낮음', style: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
}

export default function VotePage({ params }: { params: Promise<VotePageParams> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const officialPoll = useMemo(() => POLLS.find((item) => item.id === id), [id]);
  const dbPollId = officialPoll ? `official_${id}` : id;

  const [voted, setVoted] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [barWidths, setBarWidths] = useState<number[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [pollData, setPollData] = useState<ViewPoll | null>(null);
  const [isOfficial, setIsOfficial] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);

      const { data: dbPoll, error: pollError } = await supabase
        .from('polls')
        .select('*')
        .eq('id', dbPollId)
        .maybeSingle();

      if (pollError) {
        console.error('투표 데이터 로딩 실패:', pollError.message);
      }

      if (officialPoll) {
        const defaultVotes = statsToVotes(officialPoll.stats, officialPoll.participants);
        const typedDbPoll = dbPoll as DbPoll | null;

        const mergedVotes =
          typedDbPoll?.votes && typedDbPoll.votes.length === officialPoll.options.length
            ? typedDbPoll.votes
            : defaultVotes;

        const mergedPoll: ViewPoll = {
          id: dbPollId,
          title: officialPoll.title,
          category: officialPoll.category,
          options: officialPoll.options,
          votes: mergedVotes,
          participants: typedDbPoll?.participants ?? officialPoll.participants,
          officialFact: officialPoll.officialFact,
        };

        setIsOfficial(true);
        setPollData(mergedPoll);
        setBarWidths(calcPercentages(mergedVotes));
      } else if (dbPoll) {
        const typedDbPoll = dbPoll as DbPoll;
        const safeVotes = typedDbPoll.votes ?? typedDbPoll.options.map(() => 0);

        setIsOfficial(false);
        setPollData({
          id: typedDbPoll.id,
          title: typedDbPoll.title,
          category: typedDbPoll.category || '커뮤니티',
          options: typedDbPoll.options,
          votes: safeVotes,
          participants: typedDbPoll.participants || 0,
        });
        setBarWidths(calcPercentages(safeVotes));
      } else {
        setPollData(null);
      }

      const { data: dbComments, error: commentsError } = await supabase
        .from('comments')
        .select('*')
        .eq('poll_id', dbPollId)
        .order('created_at', { ascending: false });

      if (commentsError) {
        console.error('댓글 로딩 실패:', commentsError.message);
        setComments([]);
      } else {
        setComments((dbComments as CommentRow[] | null) ?? []);
      }

      setLoading(false);
    };

    fetchAllData();
  }, [dbPollId, officialPoll]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold italic text-xl">
        ANALYZING DATA HUB...
      </div>
    );
  }

  if (!pollData) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold italic text-xl">
        데이터를 찾을 수 없습니다.
      </div>
    );
  }

  const reliability = getReliability(pollData.participants);

  const handleVote = async (idx: number) => {
    if (voted) return;

    const optimisticVotes = [...pollData.votes];
    optimisticVotes[idx] += 1;

    const optimisticPoll: ViewPoll = {
      ...pollData,
      votes: optimisticVotes,
      participants: pollData.participants + 1,
    };

    setChoice(pollData.options[idx]);
    setVoted(true);
    setPollData(optimisticPoll);
    setTimeout(() => setBarWidths(calcPercentages(optimisticVotes)), 100);

    const rpcPayload = {
      p_poll_id: pollData.id,
      p_option_index: idx,
      p_title: pollData.title,
      p_category: pollData.category || '커뮤니티',
      p_options: pollData.options,
      p_seed_votes: pollData.votes,
      p_seed_participants: pollData.participants,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc('increment_poll_vote', rpcPayload);

    if (!rpcError && rpcData) {
      const row = Array.isArray(rpcData)
        ? (rpcData[0] as IncrementVoteResponse | undefined)
        : (rpcData as IncrementVoteResponse);

      if (row?.votes) {
        const synced: ViewPoll = {
          ...optimisticPoll,
          votes: row.votes,
          participants: row.participants ?? optimisticPoll.participants,
        };
        setPollData(synced);
        setBarWidths(calcPercentages(row.votes));
      }
      return;
    }

    const { error: fallbackError } = await supabase.from('polls').upsert({
      id: pollData.id,
      title: pollData.title,
      category: pollData.category || '커뮤니티',
      options: pollData.options,
      votes: optimisticVotes,
      participants: pollData.participants + 1,
    });

    if (fallbackError) {
      alert(`투표 반영 실패: ${fallbackError.message}`);
      return;
    }

    console.warn('increment_poll_vote RPC가 없어 fallback upsert로 처리했습니다.');
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const { error: ensurePollError } = await supabase.from('polls').upsert({
      id: pollData.id,
      title: pollData.title,
      options: pollData.options,
      votes: pollData.votes,
      participants: pollData.participants,
      category: pollData.category || '커뮤니티',
    });

    if (ensurePollError) {
      alert(`댓글용 투표 레코드 생성 실패: ${ensurePollError.message}`);
      return;
    }

    const { data, error } = await supabase
      .from('comments')
      .insert({
        poll_id: pollData.id,
        text: inputText.trim(),
        user_name: '익명 유저',
      })
      .select()
      .single();

    if (error) {
      alert(`댓글 등록 실패: ${error.message}`);
      return;
    }

    const newComment = data as CommentRow;
    setComments((prev) => [newComment, ...prev]);
    setInputText('');
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 pb-32">
      <nav className="border-b border-white/5 bg-[#020617]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-black text-slate-500 hover:text-white transition-colors tracking-tighter">
            ← BACK TO DATA CENTER
          </Link>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-black ${
                isOfficial ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              {isOfficial ? 'VERIFIED SOURCE' : 'COMMUNITY LIVE'}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 space-y-12">
        <header className="space-y-6 text-center">
          <span className="text-blue-500 font-black tracking-[0.2em] text-[10px] uppercase opacity-80">
            {pollData.category || 'GENERAL REPORT'}
          </span>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight break-keep">{pollData.title}</h1>
          <div className="flex justify-center items-center gap-6 text-slate-500 text-xs font-black tracking-widest">
            <span>SAMPLES: N={pollData.participants.toLocaleString()}</span>
            <span className="w-1 h-1 bg-slate-800 rounded-full"></span>
            <span>STATUS: {voted ? 'CLOSED' : 'COLLECTING'}</span>
          </div>
          {isOfficial && pollData.officialFact ? (
            <p className="text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">{pollData.officialFact}</p>
          ) : null}
        </header>

        <section className="relative">
          {!voted ? (
            <div className="grid gap-4">
              {pollData.options.map((opt, i) => (
                <button
                  key={opt}
                  onClick={() => handleVote(i)}
                  className="group w-full p-6 text-left bg-white/5 border border-white/10 rounded-2xl hover:border-blue-500/50 hover:bg-white/10 transition-all duration-300"
                >
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
                {pollData.options.map((opt, i) => (
                  <div key={opt} className="space-y-3">
                    <div className="flex justify-between items-center font-bold">
                      <span className={choice === opt ? 'text-blue-400' : 'text-slate-500'}>{opt}</span>
                      <span className="text-xl text-white font-black">{barWidths[i] || 0}%</span>
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
            <h3 className="text-2xl font-black text-white italic tracking-tighter text-blue-500">INSIGHTS</h3>
            <span className="text-slate-700 font-black text-xs">{comments.length} RESPONSES</span>
            <div className="h-px flex-1 bg-white/5"></div>
          </div>

          <form onSubmit={handleCommentSubmit} className="relative group">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full bg-white/5 border border-white/10 p-5 pr-28 rounded-2xl focus:outline-none focus:border-blue-500 focus:bg-white/10 transition-all font-bold text-white placeholder:text-slate-700"
              placeholder="의견을 남겨주세요..."
            />
            <button
              type="submit"
              className="absolute right-2 top-2 bottom-2 px-6 bg-blue-600 text-white font-black rounded-xl hover:bg-blue-500 transition-all text-xs"
            >
              POST
            </button>
          </form>

          <div className="grid gap-4">
            {comments.map((comment) => (
              <div key={comment.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-blue-500 uppercase">GUEST_USER</span>
                  <span className="text-[10px] text-slate-700 font-bold">
                    {new Date(comment.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-slate-300 font-bold leading-relaxed">{comment.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
