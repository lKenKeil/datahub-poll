'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { POLLS } from '../../../data/polls';
import { CommentRow, DbPoll } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { isValidVoterId, VOTER_ID_STORAGE_KEY } from '@/lib/voter-id';

type VotePageParams = { id: string };

type ViewPoll = {
  id: string;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
  officialFact?: string;
  optionImagePaths?: Array<string | null> | null;
};

type DbPollWithOfficialFact = DbPoll & {
  official_fact?: string;
  officialFact?: string;
};

type IncrementVoteResponse = {
  id: string;
  votes: number[];
  participants: number;
  optionIndex: number;
  changed?: boolean;
};

type CommentView = CommentRow & {
  parent_id: string | null;
  like_count: number;
  dislike_count: number;
  user_reaction: 'like' | 'dislike' | null;
};

type ShareFeedback = {
  type: 'success' | 'error';
  message: string;
};

const POLL_OPTION_IMAGES_BUCKET = 'poll-option-images';

class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

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

function normalizeOptionImagePaths(value: unknown, optionCount: number) {
  if (!Array.isArray(value) || value.length !== optionCount) return null;
  return value.map((path) => (typeof path === 'string' && path ? path : null));
}

function getOptionImagePublicUrl(
  pollId: string,
  optionIndex: number,
  objectPath: string | null | undefined,
) {
  if (!objectPath) return null;

  const expectedPrefix = `${pollId}/options/${optionIndex}/`;
  const fileName = objectPath.startsWith(expectedPrefix)
    ? objectPath.slice(expectedPrefix.length)
    : '';
  if (!/^[0-9a-f-]{36}\.webp$/i.test(fileName)) return null;

  return supabase.storage
    .from(POLL_OPTION_IMAGES_BUCKET)
    .getPublicUrl(objectPath).data.publicUrl;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to the DOM fallback for older or permission-restricted browsers.
    }
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) throw new Error('Clipboard copy was rejected.');
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
}

function getOrCreateFingerprint() {
  const key = 'dh_user_fingerprint';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const created = `fp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, created);
  return created;
}

function getOrCreateVoterId() {
  const existing = localStorage.getItem(VOTER_ID_STORAGE_KEY)?.trim().toLowerCase();
  if (isValidVoterId(existing)) return existing;

  const created = crypto.randomUUID();
  localStorage.setItem(VOTER_ID_STORAGE_KEY, created);
  return created;
}

export default function VotePage({ params }: { params: Promise<VotePageParams> }) {
  const resolvedParams = use(params);
  const id = resolvedParams.id;

  const officialPoll = useMemo(() => POLLS.find((item) => item.id === id), [id]);
  const dbPollId = officialPoll ? `official_${id}` : id;

  const [voted, setVoted] = useState(false);
  const [isRevoting, setIsRevoting] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [barWidths, setBarWidths] = useState<number[]>([]);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [pollData, setPollData] = useState<ViewPoll | null>(null);
  const [recommendationPool, setRecommendationPool] = useState<DbPoll[]>([]);
  const [isOfficial, setIsOfficial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userFingerprint, setUserFingerprint] = useState('');
  const [voterId, setVoterId] = useState('');
  const [syncState, setSyncState] = useState<'live' | 'syncing' | 'reconnecting'>('live');
  const lastSnapshotRef = useRef('');
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUserFingerprint(getOrCreateFingerprint());
    setVoterId(getOrCreateVoterId());
  }, []);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimerRef.current) clearTimeout(shareFeedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const fetchRecommendationPool = async () => {
      try {
        const response = await fetch('/api/polls', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = (await response.json()) as { data?: DbPoll[] };
        if (response.ok) setRecommendationPool(json.data ?? []);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    };

    void fetchRecommendationPool();
    return () => controller.abort();
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (!voterId) return;

    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    if (silent) setSyncState('syncing');

    try {
      const response = await fetch(`/api/polls/${dbPollId}`, {
        cache: 'no-store',
        headers: {
          ...(userFingerprint ? { 'x-user-fp': userFingerprint } : {}),
          'x-voter-id': voterId,
        },
      });
      const json = (await response.json()) as {
        poll?: DbPoll | null;
        comments?: CommentView[];
        viewerVote?: { optionIndex: number } | null;
        error?: string;
      };

      if (!response.ok) throw new Error(json.error ?? '투표 데이터 로딩 실패');

      const dbPoll = json.poll as DbPollWithOfficialFact | null;
      const dbComments = (json.comments ?? []).map((comment) => ({
        ...comment,
        parent_id: comment.parent_id ?? null,
        like_count: comment.like_count ?? 0,
        dislike_count: comment.dislike_count ?? 0,
        user_reaction: comment.user_reaction ?? null,
      }));

      const snapshot = JSON.stringify({
        poll: dbPoll
          ? {
              id: dbPoll.id,
              votes: dbPoll.votes,
              participants: dbPoll.participants,
            }
          : null,
        viewerVote: json.viewerVote ?? null,
        comments: dbComments.map((comment) => ({
          id: comment.id,
          parent_id: comment.parent_id,
          like_count: comment.like_count,
          dislike_count: comment.dislike_count,
          user_reaction: comment.user_reaction,
          text: comment.text,
          created_at: comment.created_at,
        })),
      });

      if (silent && lastSnapshotRef.current === snapshot) {
        setSyncState('live');
        return;
      }
      lastSnapshotRef.current = snapshot;

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
          optionImagePaths: null,
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
          officialFact: dbPoll.officialFact ?? dbPoll.official_fact,
          optionImagePaths: normalizeOptionImagePaths(
            dbPoll.option_image_paths,
            dbPoll.options.length,
          ),
        });
        setBarWidths(calcPercentages(safeVotes));
      } else if (!silent) {
        setPollData(null);
      }

      const visibleOptions = officialPoll?.options ?? dbPoll?.options ?? [];
      const selectedOptionIndex = json.viewerVote?.optionIndex;
      if (
        Number.isInteger(selectedOptionIndex)
        && (selectedOptionIndex as number) >= 0
        && (selectedOptionIndex as number) < visibleOptions.length
      ) {
        setVoted(true);
        setChoice(visibleOptions[selectedOptionIndex as number]);
        setSelectedOptionIndex(selectedOptionIndex as number);
      } else if (!silent) {
        setVoted(false);
        setChoice(null);
        setSelectedOptionIndex(null);
      }

      setComments(dbComments);
      setSyncState('live');
    } catch (error) {
      console.error('투표 페이지 로딩 실패:', getErrorMessage(error));
      if (silent) setSyncState('reconnecting');
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
          optionImagePaths: null,
        });
        setBarWidths(calcPercentages(fallbackVotes));
      } else if (!silent) {
        setPollData(null);
      }
      if (!silent) {
        setComments([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [dbPollId, officialPoll, userFingerprint, voterId]);

  const scheduleSilentRefresh = useCallback(() => {
    if (silentRefreshTimerRef.current) {
      clearTimeout(silentRefreshTimerRef.current);
    }
    silentRefreshTimerRef.current = setTimeout(() => {
      void fetchAllData({ silent: true });
    }, 400);
  }, [fetchAllData]);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  useEffect(() => {
    if (!dbPollId) return;

    const channel = supabase
      .channel(`poll-live-${dbPollId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'polls', filter: `id=eq.${dbPollId}` },
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
          scheduleSilentRefresh();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comment_reactions' },
        () => {
          scheduleSilentRefresh();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setSyncState('live');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setSyncState('reconnecting');
        }
      });

    const interval = setInterval(() => {
      void fetchAllData({ silent: true });
    }, 20000);

    return () => {
      clearInterval(interval);
      if (silentRefreshTimerRef.current) {
        clearTimeout(silentRefreshTimerRef.current);
      }
      void supabase.removeChannel(channel);
    };
  }, [dbPollId, fetchAllData, scheduleSilentRefresh]);

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
  const optionImageUrls = useMemo(() => {
    if (!pollData) return [];
    return pollData.options.map((_, index) => getOptionImagePublicUrl(
      pollData.id,
      index,
      pollData.optionImagePaths?.[index],
    ));
  }, [pollData]);

  if (loading) {
    return <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-lg">투표를 불러오는 중...</div>;
  }

  if (!pollData) {
    return <div className="min-h-screen bg-slate-50 dark:bg-[#020617] flex items-center justify-center text-slate-500 dark:text-slate-400 font-bold text-lg">투표를 찾을 수 없어요.</div>;
  }

  const selectedPercentage = selectedOptionIndex === null ? 0 : (barWidths[selectedOptionIndex] ?? 0);
  const relatedPolls = [...recommendationPool]
    .filter((poll) => poll.id !== pollData.id && poll.id !== id && poll.id !== dbPollId)
    .sort((a, b) => {
      const categoryPriority = Number(b.category === pollData.category) - Number(a.category === pollData.category);
      if (categoryPriority !== 0) return categoryPriority;
      const participantPriority = (b.participants ?? 0) - (a.participants ?? 0);
      if (participantPriority !== 0) return participantPriority;
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, 4);

  const showShareFeedback = (feedback: ShareFeedback) => {
    if (shareFeedbackTimerRef.current) clearTimeout(shareFeedbackTimerRef.current);
    setShareFeedback(feedback);
    shareFeedbackTimerRef.current = setTimeout(() => {
      setShareFeedback(null);
      shareFeedbackTimerRef.current = null;
    }, 3200);
  };

  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);

    const shareUrl = new URL(window.location.pathname, window.location.origin).toString();
    const shareText = voted && choice && selectedOptionIndex !== null
      ? `내 선택은 '${choice}'! ${selectedPercentage}%가 같은 선택을 했어요. 당신의 선택은?`
      : `'${pollData.title}' 투표에 참여해보세요. 당신의 선택은?`;

    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: pollData.title,
            text: shareText,
            url: shareUrl,
          });
          showShareFeedback({ type: 'success', message: '공유가 완료됐어요.' });
          return;
        } catch {
          // Cancellation and unsupported share targets both continue to URL copy.
        }
      }

      await copyTextToClipboard(shareUrl);
      showShareFeedback({ type: 'success', message: '링크를 복사했어요.' });
    } catch {
      showShareFeedback({ type: 'error', message: '공유하지 못했어요. 잠시 후 다시 시도해주세요.' });
    } finally {
      setIsSharing(false);
    }
  };

  const handleVote = async (idx: number) => {
    if (voted || !voterId) return;
    setActionError('');

    const previousPoll = pollData;
    const optimisticVotes = [...pollData.votes];
    optimisticVotes[idx] += 1;

    setChoice(pollData.options[idx]);
    setSelectedOptionIndex(idx);
    setVoted(true);
    setPollData({ ...pollData, votes: optimisticVotes, participants: pollData.participants + 1 });
    setTimeout(() => setBarWidths(calcPercentages(optimisticVotes)), 100);

    try {
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex: idx, voterId }),
      });

      const json = (await response.json()) as { data?: IncrementVoteResponse; error?: string };
      if (response.status === 409) {
        await fetchAllData({ silent: true });
        return;
      }
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '투표 반영 실패', response.status);

      setPollData((prev) => (prev ? { ...prev, votes: json.data!.votes, participants: json.data!.participants } : prev));
      setChoice(pollData.options[json.data.optionIndex] ?? pollData.options[idx]);
      setSelectedOptionIndex(json.data.optionIndex);
      setBarWidths(calcPercentages(json.data.votes));
    } catch (error) {
      setPollData(previousPoll);
      setVoted(false);
      setChoice(null);
      setSelectedOptionIndex(null);
      setBarWidths(calcPercentages(previousPoll.votes));
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`투표 반영 실패: ${getErrorMessage(error)}`);
      }
    }
  };

  const handleRevote = async (idx: number) => {
    if (!voted || !voterId || selectedOptionIndex === null) return;
    setActionError('');

    if (idx === selectedOptionIndex) {
      setIsRevoting(false);
      return;
    }

    const previousPoll = pollData;
    const previousChoice = choice;
    const previousOptionIndex = selectedOptionIndex;
    const optimisticVotes = [...pollData.votes];
    optimisticVotes[previousOptionIndex] = Math.max(0, optimisticVotes[previousOptionIndex] - 1);
    optimisticVotes[idx] += 1;

    setChoice(pollData.options[idx]);
    setSelectedOptionIndex(idx);
    setIsRevoting(false);
    setPollData({ ...pollData, votes: optimisticVotes });
    setBarWidths(calcPercentages(optimisticVotes));

    try {
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex: idx, voterId }),
      });

      const json = (await response.json()) as { data?: IncrementVoteResponse; error?: string };
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '투표 변경 실패', response.status);

      setPollData((prev) => (prev ? { ...prev, votes: json.data!.votes, participants: json.data!.participants } : prev));
      setChoice(pollData.options[json.data.optionIndex] ?? pollData.options[idx]);
      setSelectedOptionIndex(json.data.optionIndex);
      setBarWidths(calcPercentages(json.data.votes));
    } catch (error) {
      setPollData(previousPoll);
      setChoice(previousChoice);
      setSelectedOptionIndex(previousOptionIndex);
      setIsRevoting(true);
      setBarWidths(calcPercentages(previousPoll.votes));
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`투표 변경 실패: ${getErrorMessage(error)}`);
      }
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    setActionError('');

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          parentId: null,
        }),
      });

      const json = (await response.json()) as { data?: CommentView; error?: string };
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '댓글 등록 실패', response.status);

      setComments((prev) => [{ ...json.data!, parent_id: null, like_count: 0, dislike_count: 0, user_reaction: null }, ...prev]);
      setInputText('');
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`댓글 등록 실패: ${getErrorMessage(error)}`);
      }
    }
  };

  const handleReplySubmit = async (parentId: string) => {
    if (!replyText.trim()) return;
    setActionError('');

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: replyText.trim(),
          parentId,
        }),
      });

      const json = (await response.json()) as { data?: CommentView; error?: string };
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '답글 등록 실패', response.status);

      setComments((prev) => [
        { ...json.data!, parent_id: parentId, like_count: 0, dislike_count: 0, user_reaction: null },
        ...prev,
      ]);
      setReplyText('');
      setReplyTargetId(null);
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`답글 등록 실패: ${getErrorMessage(error)}`);
      }
    }
  };

  const handleReaction = async (commentId: string, reaction: 'like' | 'dislike') => {
    setActionError('');
    try {
      const target = comments.find((comment) => String(comment.id) === commentId);
      const nextReaction = target?.user_reaction === reaction ? null : reaction;

      const response = await fetch(`/api/comments/${commentId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userFingerprint, reaction: nextReaction }),
      });

      const json = (await response.json()) as { likeCount?: number; dislikeCount?: number; userReaction?: 'like' | 'dislike' | null; error?: string };

      if (!response.ok) throw new ApiResponseError(json.error ?? '반응 처리 실패', response.status);

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
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`공감 반영 실패: ${getErrorMessage(error)}`);
      }
    }
  };

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 pb-24 text-slate-900 dark:bg-[#020617] dark:text-slate-200">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-white/5 dark:bg-[#020617]/80">
        <div className="mx-auto flex min-w-0 max-w-[1440px] items-center justify-between gap-4 px-4 py-4 pr-24 sm:px-6 sm:pr-28 lg:px-8 lg:pr-28">
          <Link href="/" className="text-sm font-black text-slate-500 transition-colors hover:text-blue-600 dark:hover:text-white">← 홈으로</Link>
          <div className="hidden items-center gap-2 sm:flex">
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${isOfficial ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'}`}>
              {isOfficial ? '공식 데이터 기반' : '커뮤니티 투표'}
            </span>
            <span className={`hidden rounded-full px-3 py-1 text-[11px] font-black sm:inline-flex ${voted ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>
              {voted ? '참여 완료' : '투표 진행 중'}
            </span>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1280px] space-y-8 px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-blue-200/70 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-6 dark:border-blue-500/20 dark:from-slate-900 dark:via-[#07152f] dark:to-[#052631] md:p-10">
          <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">{pollData.category || '기타'}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${voted ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-white/80 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>
                {voted ? '참여 완료' : '투표 진행 중'}
              </span>
            </div>
            <h1 className="mt-5 break-words text-3xl font-black leading-tight tracking-[-0.035em] text-slate-950 dark:text-white sm:text-4xl md:text-5xl">{pollData.title}</h1>
            <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-300 sm:text-base">
              {isRevoting ? '기존 선택을 다른 선택지로 바꿔보세요.' : voted ? '내 선택과 전체 결과를 비교해보세요.' : '당신의 선택은 어느 쪽인가요? 하나를 고르면 바로 결과를 볼 수 있어요.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-bold text-slate-500">
              <span>참여자 {pollData.participants.toLocaleString()}명</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span>의견 {comments.length}개</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span className={syncState === 'reconnecting' ? 'text-rose-500' : syncState === 'syncing' ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-300'}>
                {syncState === 'live' ? '실시간 반영 중' : syncState === 'syncing' ? '결과 동기화 중' : '재연결 중'}
              </span>
            </div>
          </div>
        </header>

        {actionError ? (
          <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center text-sm font-bold text-amber-700 dark:text-amber-300">
            {actionError}
          </div>
        ) : null}

        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-xl shadow-slate-950/[0.04] dark:border-white/10 dark:bg-white/[0.035] sm:p-7 md:p-9">
            {!voted || isRevoting ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black text-slate-950 dark:text-white">{isRevoting ? '선택을 바꿔볼까요?' : '어느 쪽을 고르세요'}</h2>
                    <p className="mt-2 text-sm text-slate-500">{isRevoting ? '같은 선택지를 누르면 변경 없이 결과로 돌아가요.' : '선택하면 전체 결과를 확인할 수 있어요.'}</p>
                  </div>
                  {isRevoting ? (
                    <button type="button" onClick={() => setIsRevoting(false)} className="text-sm font-black text-slate-500 hover:text-blue-600">취소</button>
                  ) : null}
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {pollData.options.map((option, index) => {
                    const isCurrent = isRevoting && selectedOptionIndex === index;
                    const imageUrl = optionImageUrls[index];
                    return (
                      <button
                        key={`${option}_${index}`}
                        type="button"
                        onClick={() => (isRevoting ? handleRevote(index) : handleVote(index))}
                        className={`group w-full min-w-0 overflow-hidden rounded-2xl border text-left transition duration-200 active:scale-[0.99] ${imageUrl ? 'flex flex-col p-3' : 'flex min-h-28 items-center justify-between gap-4 p-5'} ${isCurrent ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15 dark:bg-blue-500/10' : 'border-slate-200 bg-slate-50 hover:-translate-y-0.5 hover:border-blue-500 hover:bg-blue-50 dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-blue-500/10'}`}
                      >
                        {imageUrl ? (
                          <span className="relative block aspect-[4/3] max-h-72 w-full overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-900">
                            <Image
                              src={imageUrl}
                              alt=""
                              fill
                              unoptimized
                              sizes="(max-width: 640px) 100vw, 50vw"
                              className="object-cover transition duration-300 group-hover:scale-[1.02]"
                            />
                          </span>
                        ) : null}
                        <span className={`flex w-full min-w-0 items-center justify-between gap-3 ${imageUrl ? 'px-1 pb-1 pt-4' : ''}`}>
                          <span className="flex min-w-0 items-center gap-3">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${isCurrent ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 shadow-sm dark:bg-white/10 dark:text-blue-300'}`}>{index + 1}</span>
                            <span className="min-w-0 break-words text-base font-black text-slate-900 dark:text-white sm:text-lg">{option}</span>
                          </span>
                          <span className={`hidden shrink-0 text-xs font-black text-blue-600 transition dark:text-blue-300 sm:inline ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
                            {isCurrent ? '현재 선택 ✓' : '선택 →'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-5 text-center text-xs font-semibold text-slate-400">선택하면 결과를 확인할 수 있어요. 투표 후에도 선택을 바꿀 수 있어요.
                </p>
              </div>
            ) : (
              <div aria-live="polite">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-700 dark:text-emerald-300">참여 완료</span>
                    <h2 className="mt-3 text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">투표 결과</h2>
                    <p className="mt-2 text-sm text-slate-500">총 {pollData.participants.toLocaleString()}명이 참여했어요.</p>
                  </div>
                  <div className="rounded-2xl bg-blue-600 px-4 py-3 text-right text-white shadow-lg shadow-blue-600/20">
                    <p className="text-[11px] font-bold text-blue-100">내 선택</p>
                    <p className="mt-0.5 max-w-64 break-words text-sm font-black sm:text-base">{choice} ✓</p>
                  </div>
                </div>

                <div className="mt-8 space-y-4">
                  {pollData.options.map((option, index) => {
                    const isSelected = selectedOptionIndex === index;
                    const percentage = barWidths[index] ?? 0;
                    const voteCount = pollData.votes[index] ?? 0;
                    const imageUrl = optionImageUrls[index];
                    return (
                      <div key={`${option}_${index}`} className={`rounded-2xl border p-4 sm:p-5 ${isSelected ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-500/10 dark:bg-blue-500/10' : 'border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.025]'}`}>
                        <div className={imageUrl ? 'grid gap-4 sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)] sm:items-center' : ''}>
                          {imageUrl ? (
                            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-900">
                              <Image
                                src={imageUrl}
                                alt=""
                                fill
                                unoptimized
                                sizes="(max-width: 640px) 100vw, 220px"
                                className="object-cover"
                              />
                            </div>
                          ) : null}
                          <div className={imageUrl ? 'min-w-0' : ''}>
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`break-words font-black ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}`}>{option}</span>
                                  {isSelected ? <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">내 선택 ✓</span> : null}
                                </div>
                                <p className="mt-1 text-xs font-semibold text-slate-500">{voteCount.toLocaleString()}표</p>
                              </div>
                              <span className={`text-2xl font-black ${isSelected ? 'text-blue-600 dark:text-blue-300' : 'text-slate-900 dark:text-white'}`}>{percentage}%</span>
                            </div>
                            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                              <div className={`h-full rounded-full transition-all duration-700 ease-out ${isSelected ? 'bg-gradient-to-r from-blue-600 to-cyan-400' : 'bg-slate-400 dark:bg-slate-500'}`} style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-7 rounded-2xl border border-blue-500/20 bg-blue-500/10 px-5 py-4 text-center">
                  <p className="font-black text-blue-700 dark:text-blue-200"><span className="text-2xl">{selectedPercentage}%</span>가 나와 같은 선택을 했어요.</p>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => setIsRevoting(true)} className="flex-1 rounded-full border border-blue-500/40 px-5 py-3 text-sm font-black text-blue-700 transition hover:border-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10">다시 투표하기</button>
                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    disabled={isSharing}
                    aria-label={`${pollData.title} 공유하기`}
                    aria-busy={isSharing}
                    className="flex-1 rounded-full bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
                  >
                    {isSharing ? '공유 준비 중...' : '공유하기'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035]">
              <h2 className="text-base font-black text-slate-950 dark:text-white">한눈에 보기</h2>
              <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-1">
                <div className="rounded-2xl bg-slate-100 p-4 dark:bg-white/5">
                  <dt className="text-xs font-bold text-slate-500">참여자</dt>
                  <dd className="mt-1 text-xl font-black">{pollData.participants.toLocaleString()}명</dd>
                </div>
                <div className="rounded-2xl bg-slate-100 p-4 dark:bg-white/5">
                  <dt className="text-xs font-bold text-slate-500">현재 상태</dt>
                  <dd className="mt-1 text-base font-black text-blue-600 dark:text-blue-300">{voted ? '참여 완료' : '투표 진행 중'}</dd>
                </div>
              </dl>
              {!voted ? (
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  disabled={isSharing}
                  aria-label={`${pollData.title} 공유하기`}
                  aria-busy={isSharing}
                  className="mt-4 w-full rounded-full bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-70"
                >
                  {isSharing ? '공유 준비 중...' : '공유하기'}
                </button>
              ) : null}
            </section>

            {pollData.officialFact ? (
              <section className="rounded-3xl border border-cyan-500/20 bg-cyan-50/70 p-5 dark:bg-cyan-950/20">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/15 text-sm font-black text-cyan-700 dark:text-cyan-300">i</span>
                  <h2 className="font-black text-cyan-900 dark:text-cyan-100">관련 데이터</h2>
                </div>
                <p className="mt-3 break-keep text-sm font-semibold leading-relaxed text-slate-600 dark:text-slate-300">{pollData.officialFact}</p>
                <p className="mt-3 text-[11px] font-bold text-cyan-700/70 dark:text-cyan-300/70">판단을 돕는 참고 정보예요.</p>
              </section>
            ) : null}
          </aside>
        </div>

        <div className="grid items-start gap-8 pt-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">💬 사람들의 의견</h2>
                <p className="mt-2 text-sm text-slate-500">다른 사람은 왜 그렇게 골랐는지 이야기해보세요.</p>
              </div>
              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-600 dark:bg-white/10 dark:text-slate-300">의견 {comments.length}개</span>
            </div>

            <form onSubmit={handleCommentSubmit} className="rounded-3xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.035] sm:p-5">
              <label htmlFor="comment-input" className="text-sm font-black text-slate-700 dark:text-slate-200">내 의견 남기기</label>
              <textarea
                id="comment-input"
                rows={3}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white"
                placeholder="이 투표에 대한 생각을 남겨주세요."
              />
              <div className="mt-3 flex justify-end">
                <button type="submit" className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-blue-500">의견 등록</button>
              </div>
            </form>

            {parentComments.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/10">아직 의견이 없어요. 첫 의견을 남겨보세요.</div>
            ) : (
              <div className="grid gap-4">
                {parentComments.map((comment) => (
                  <article key={comment.id} className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.025] sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-black text-blue-600 dark:text-blue-300">익명 사용자</span>
                      <time className="text-xs font-semibold text-slate-400">{new Date(comment.created_at).toLocaleDateString('ko-KR')}</time>
                    </div>
                    <p className="mt-4 whitespace-pre-wrap break-words font-semibold leading-relaxed text-slate-700 dark:text-slate-300">{comment.text}</p>

                    <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                      <button type="button" onClick={() => handleReaction(String(comment.id), 'like')} className={`rounded-full border px-3 py-1.5 font-bold transition ${comment.user_reaction === 'like' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:border-emerald-400 dark:border-white/10 dark:text-slate-400'}`}>👍 좋아요 {comment.like_count}</button>
                      <button type="button" onClick={() => handleReaction(String(comment.id), 'dislike')} className={`rounded-full border px-3 py-1.5 font-bold transition ${comment.user_reaction === 'dislike' ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-slate-200 text-slate-500 hover:border-rose-400 dark:border-white/10 dark:text-slate-400'}`}>👎 싫어요 {comment.dislike_count}</button>
                      <button type="button" onClick={() => setReplyTargetId(replyTargetId === String(comment.id) ? null : String(comment.id))} className="rounded-full border border-slate-200 px-3 py-1.5 font-bold text-slate-500 transition hover:border-blue-400 hover:text-blue-600 dark:border-white/10 dark:text-slate-400">답글</button>
                    </div>

                    {replyTargetId === String(comment.id) ? (
                      <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.035] sm:flex-row">
                        <input value={replyText} onChange={(event) => setReplyText(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-blue-500 dark:border-white/10 dark:bg-white/5" placeholder="답글을 입력하세요" />
                        <button type="button" onClick={() => void handleReplySubmit(String(comment.id))} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white">등록</button>
                      </div>
                    ) : null}

                    {(repliesByParent.get(String(comment.id)) ?? []).length > 0 ? (
                      <div className="mt-5 space-y-3 border-l-2 border-blue-500/20 pl-3 sm:pl-5">
                        {(repliesByParent.get(String(comment.id)) ?? []).map((reply) => (
                          <div key={reply.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.025]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-black text-indigo-600 dark:text-indigo-300">답글 · 익명 사용자</span>
                              <time className="text-xs font-semibold text-slate-400">{new Date(reply.created_at).toLocaleDateString('ko-KR')}</time>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-300">{reply.text}</p>
                            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                              <button type="button" onClick={() => handleReaction(String(reply.id), 'like')} className={`rounded-full border px-3 py-1 font-bold ${reply.user_reaction === 'like' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400'}`}>👍 {reply.like_count}</button>
                              <button type="button" onClick={() => handleReaction(String(reply.id), 'dislike')} className={`rounded-full border px-3 py-1 font-bold ${reply.user_reaction === 'dislike' ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400'}`}>👎 {reply.dislike_count}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-24">
            <div>
              <h2 className="text-xl font-black text-slate-950 dark:text-white">이 투표도 해보세요</h2>
              <p className="mt-1 text-sm text-slate-500">같은 관심사와 인기 투표를 모았어요.</p>
            </div>
            {relatedPolls.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-white/10">
                다른 투표를 불러오고 있어요. <Link href="/" className="font-black text-blue-600 dark:text-blue-300">홈에서 둘러보기</Link>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {relatedPolls.map((poll) => (
                  <Link key={poll.id} href={`/vote/${poll.id}`} className="group rounded-3xl border border-slate-200 bg-white p-5 transition hover:border-blue-500 hover:shadow-lg hover:shadow-blue-950/5 dark:border-white/10 dark:bg-white/[0.035]">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold">
                      <span className="text-blue-600 dark:text-blue-300">{poll.category || '커뮤니티'}</span>
                      {poll.category === pollData.category ? <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-600 dark:text-blue-300">같은 카테고리</span> : null}
                    </div>
                    <h3 className="mt-3 break-words font-black leading-snug text-slate-900 dark:text-white">{poll.title}</h3>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs dark:border-white/10">
                      <span className="font-bold text-slate-500">참여자 {(poll.participants ?? 0).toLocaleString()}명</span>
                      <span className="font-black text-blue-600 transition-transform group-hover:translate-x-1 dark:text-blue-300">투표하기 →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>

      {shareFeedback ? (
        <div
          role={shareFeedback.type === 'error' ? 'alert' : 'status'}
          aria-live={shareFeedback.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`pointer-events-none fixed bottom-6 left-1/2 z-[110] w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 rounded-2xl border px-5 py-3 text-center text-sm font-black shadow-2xl backdrop-blur-xl ${shareFeedback.type === 'error' ? 'border-rose-500/30 bg-rose-950/90 text-rose-100' : 'border-emerald-500/30 bg-slate-950/90 text-emerald-200'}`}
        >
          {shareFeedback.message}
        </div>
      ) : null}
    </main>
  );
}
