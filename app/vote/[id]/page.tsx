'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { POLLS } from '../../../data/polls';
import { CommentRow, DbPoll } from '@/lib/types';
import { supabase } from '@/lib/supabase';

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

type CommentView = CommentRow & {
  parent_id: string | null;
  like_count: number;
  dislike_count: number;
  user_reaction: 'like' | 'dislike' | null;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function statsToVotes(stats: number[], participants: number) {
  return stats.map((ratio) => Math.max(0, Math.round((participants * ratio) / 100)));
}

function calcPercentages(votes: number[]) {
  const total = votes.reduce((acc, curr) => acc + curr, 0);
  if (total === 0) return votes.map(() => 0);
  return votes.map((value) => Math.round((value / total) * 100));
}

function getReliability(participants: number) {
  if (participants >= 1000) return { label: '신뢰도 높음', style: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
  if (participants >= 300) return { label: '신뢰도 보통', style: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
  return { label: '신뢰도 낮음', style: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
}

function getOrCreateFingerprint() {
  const key = 'dh_user_fingerprint';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = `fp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, created);
  return created;
}

export default function VotePage({ params }: { params: Promise<VotePageParams> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const officialPoll = useMemo(() => POLLS.find((item) => item.id === id), [id]);
  const dbPollId = officialPoll ? `official_${id}` : id;

  const [voted, setVoted] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [barWidths, setBarWidths] = useState<number[]>([]);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [pollData, setPollData] = useState<ViewPoll | null>(null);
  const [isOfficial, setIsOfficial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userFingerprint, setUserFingerprint] = useState('');

  useEffect(() => {
    setUserFingerprint(getOrCreateFingerprint());
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/polls/${dbPollId}`, {
        cache: 'no-store',
        headers: userFingerprint ? { 'x-user-fp': userFingerprint } : undefined,
      });
      const json = (await response.json()) as { poll?: DbPoll | null; comments?: CommentView[]; error?: string };

      if (!response.ok) throw new Error(json.error ?? '투표 데이터 로딩 실패');

      const dbPoll = json.poll;
      const dbComments = (json.comments ?? []).map((comment) => ({
        ...comment,
        parent_id: comment.parent_id ?? null,
        like_count: comment.like_count ?? 0,
        dislike_count: comment.dislike_count ?? 0,
        user_reaction: comment.user_reaction ?? null,
      }));

      if (officialPoll) {
        const defaultVotes = statsToVotes(officialPoll.stats, officialPoll.participants);
        const mergedVotes = dbPoll?.votes && dbPoll.votes.length === officialPoll.options.length ? dbPoll.votes : defaultVotes;

        setIsOfficial(true);
        setPollData({
          id: dbPollId,
          title: officialPoll.title,
          category: officialPoll.category,
          options: officialPoll.options,
          votes: mergedVotes,
          participants: dbPoll?.participants ?? officialPoll.participants,
          officialFact: officialPoll.officialFact,
        });
        setBarWidths(calcPercentages(mergedVotes));
      } else if (dbPoll) {
        const safeVotes = dbPoll.votes ?? dbPoll.options.map(() => 0);
        setIsOfficial(false);
        setPollData({
          id: dbPoll.id,
          title: dbPoll.title,
          category: dbPoll.category || '커뮤니티',
          options: dbPoll.options,
          votes: safeVotes,
          participants: dbPoll.participants || 0,
        });
        setBarWidths(calcPercentages(safeVotes));
      } else {
        setPollData(null);
      }

      setComments(dbComments);
    } catch (error) {
      console.error('투표 페이지 로딩 실패:', getErrorMessage(error));
      if (officialPoll) {
        const fallbackVotes = statsToVotes(officialPoll.stats, officialPoll.participants);
        setIsOfficial(true);
        setPollData({
          id: dbPollId,
          title: officialPoll.title,
          category: officialPoll.category,
          options: officialPoll.options,
          votes: fallbackVotes,
          participants: officialPoll.participants,
          officialFact: officialPoll.officialFact,
        });
        setBarWidths(calcPercentages(fallbackVotes));
      } else {
        setPollData(null);
      }
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [dbPollId, officialPoll, userFingerprint]);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    if (!dbPollId) return;

    const channel = supabase
      .channel(`poll-live-${dbPollId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'polls', filter: `id=eq.${dbPollId}` },
        (payload) => {
          const row = payload.new as DbPoll;
          if (!row?.votes) return;
          setPollData((prev) => (prev ? { ...prev, votes: row.votes, participants: row.participants ?? prev.participants } : prev));
          setBarWidths(calcPercentages(row.votes));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `poll_id=eq.${dbPollId}` },
        () => {
          void fetchAllData();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [dbPollId, fetchAllData]);

  const parentComments = useMemo(() => comments.filter((comment) => !comment.parent_id), [comments]);
  const repliesByParent = useMemo(() => {
    const map = new Map<string, CommentView[]>();
    for (const comment of comments) {
      if (!comment.parent_id) continue;
      const key = String(comment.parent_id);
      const list = map.get(key) ?? [];
      list.push(comment);
      map.set(key, list);
    }
    return map;
  }, [comments]);

  if (loading) {
    return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold italic text-xl">ANALYZING DATA HUB...</div>;
  }

  if (!pollData) {
    return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-slate-400 font-bold italic text-xl">데이터를 찾을 수 없습니다.</div>;
  }

  const reliability = getReliability(pollData.participants);

  const handleVote = async (idx: number) => {
    if (voted) return;

    const previousPoll = pollData;
    const optimisticVotes = [...pollData.votes];
    optimisticVotes[idx] += 1;

    setChoice(pollData.options[idx]);
    setVoted(true);
    setPollData({ ...pollData, votes: optimisticVotes, participants: pollData.participants + 1 });
    setTimeout(() => setBarWidths(calcPercentages(optimisticVotes)), 100);

    try {
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          optionIndex: idx,
          title: pollData.title,
          category: pollData.category || '커뮤니티',
          options: pollData.options,
          votes: pollData.votes,
          participants: pollData.participants,
        }),
      });

      const json = (await response.json()) as { data?: IncrementVoteResponse; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error ?? '투표 반영 실패');

      setPollData((prev) => (prev ? { ...prev, votes: json.data!.votes, participants: json.data!.participants } : prev));
      setBarWidths(calcPercentages(json.data.votes));
    } catch (error) {
      setPollData(previousPoll);
      setVoted(false);
      setChoice(null);
      setBarWidths(calcPercentages(previousPoll.votes));
      alert(`투표 반영 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          title: pollData.title,
          category: pollData.category || '커뮤니티',
          options: pollData.options,
          votes: pollData.votes,
          participants: pollData.participants,
          parentId: null,
        }),
      });

      const json = (await response.json()) as { data?: CommentView; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error ?? '댓글 등록 실패');

      setComments((prev) => [{ ...json.data!, parent_id: null, like_count: 0, dislike_count: 0, user_reaction: null }, ...prev]);
      setInputText('');
    } catch (error) {
      alert(`댓글 등록 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleReplySubmit = async (parentId: string) => {
    if (!replyText.trim()) return;

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: replyText.trim(),
          title: pollData.title,
          category: pollData.category || '커뮤니티',
          options: pollData.options,
          votes: pollData.votes,
          participants: pollData.participants,
          parentId,
        }),
      });

      const json = (await response.json()) as { data?: CommentView; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error ?? '답글 등록 실패');

      setComments((prev) => [
        { ...json.data!, parent_id: parentId, like_count: 0, dislike_count: 0, user_reaction: null },
        ...prev,
      ]);
      setReplyText('');
      setReplyTargetId(null);
    } catch (error) {
      alert(`답글 등록 실패: ${getErrorMessage(error)}`);
    }
  };

  const handleReaction = async (commentId: string, reaction: 'like' | 'dislike') => {
    try {
      const target = comments.find((comment) => String(comment.id) === commentId);
      const nextReaction = target?.user_reaction === reaction ? null : reaction;

      const response = await fetch(`/api/comments/${commentId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userFingerprint, reaction: nextReaction }),
      });

      const json = (await response.json()) as { likeCount?: number; dislikeCount?: number; userReaction?: 'like' | 'dislike' | null; error?: string };

      if (!response.ok) throw new Error(json.error ?? '반응 처리 실패');

      setComments((prev) =>
        prev.map((comment) =>
          String(comment.id) === commentId
            ? {
                ...comment,
                like_count: json.likeCount ?? comment.like_count,
                dislike_count: json.dislikeCount ?? comment.dislike_count,
                user_reaction: json.userReaction ?? null,
              }
            : comment,
        ),
      );
    } catch (error) {
      alert(`공감 반영 실패: ${getErrorMessage(error)}`);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 pb-32">
      <nav className="border-b border-white/5 bg-[#020617]/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-black text-slate-500 hover:text-white transition-colors tracking-tighter">← BACK TO DATA CENTER</Link>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-black ${isOfficial ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{isOfficial ? 'VERIFIED SOURCE' : 'COMMUNITY LIVE'}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${reliability.style}`}>{reliability.label}</span>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 space-y-12">
        <header className="space-y-6 text-center">
          <span className="text-blue-500 font-black tracking-[0.2em] text-[10px] uppercase opacity-80">{pollData.category || 'GENERAL REPORT'}</span>
          <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight break-keep">{pollData.title}</h1>
          <div className="flex justify-center items-center gap-6 text-slate-500 text-xs font-black tracking-widest">
            <span>SAMPLES: N={pollData.participants.toLocaleString()}</span>
            <span className="w-1 h-1 bg-slate-800 rounded-full"></span>
            <span>STATUS: {voted ? 'CLOSED' : 'COLLECTING'}</span>
          </div>
          {isOfficial && pollData.officialFact ? <p className="text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">{pollData.officialFact}</p> : null}
        </header>

        <section className="relative">
          {!voted ? (
            <div className="grid gap-4">
              {pollData.options.map((opt, i) => (
                <button key={opt} onClick={() => handleVote(i)} className="group w-full p-6 text-left bg-white/5 border border-white/10 rounded-2xl hover:border-blue-500/50 hover:bg-white/10 transition-all duration-300">
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
            {parentComments.map((comment) => (
              <div key={comment.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-blue-500 uppercase">GUEST_USER</span>
                  <span className="text-[10px] text-slate-700 font-bold">{new Date(comment.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-300 font-bold leading-relaxed">{comment.text}</p>

                <div className="flex items-center gap-2 text-xs">
                  <button onClick={() => handleReaction(String(comment.id), 'like')} className={`px-3 py-1 rounded-full border ${comment.user_reaction === 'like' ? 'border-emerald-400 text-emerald-300' : 'border-white/10 text-slate-400'}`}>좋아요 {comment.like_count}</button>
                  <button onClick={() => handleReaction(String(comment.id), 'dislike')} className={`px-3 py-1 rounded-full border ${comment.user_reaction === 'dislike' ? 'border-rose-400 text-rose-300' : 'border-white/10 text-slate-400'}`}>싫어요 {comment.dislike_count}</button>
                  <button onClick={() => setReplyTargetId(replyTargetId === String(comment.id) ? null : String(comment.id))} className="px-3 py-1 rounded-full border border-white/10 text-slate-400">답글</button>
                </div>

                {replyTargetId === String(comment.id) ? (
                  <div className="flex gap-2">
                    <input value={replyText} onChange={(e) => setReplyText(e.target.value)} className="flex-1 bg-white/5 border border-white/10 p-3 rounded-xl text-sm" placeholder="답글을 입력하세요" />
                    <button onClick={() => void handleReplySubmit(String(comment.id))} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">등록</button>
                  </div>
                ) : null}

                {(repliesByParent.get(String(comment.id)) ?? []).map((reply) => (
                  <div key={reply.id} className="ml-6 p-4 bg-white/[0.02] border border-white/5 rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-indigo-400 uppercase">REPLY</span>
                      <span className="text-[10px] text-slate-700 font-bold">{new Date(reply.created_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-slate-300 text-sm font-medium">{reply.text}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <button onClick={() => handleReaction(String(reply.id), 'like')} className={`px-3 py-1 rounded-full border ${reply.user_reaction === 'like' ? 'border-emerald-400 text-emerald-300' : 'border-white/10 text-slate-400'}`}>좋아요 {reply.like_count}</button>
                      <button onClick={() => handleReaction(String(reply.id), 'dislike')} className={`px-3 py-1 rounded-full border ${reply.user_reaction === 'dislike' ? 'border-rose-400 text-rose-300' : 'border-white/10 text-slate-400'}`}>싫어요 {reply.dislike_count}</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
