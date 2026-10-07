'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ThemeToggle } from '@/components/theme-toggle';
import { AuthButton } from '@/components/auth-button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useAuth } from '@/components/auth-provider';
import { BrandHomeLink } from '@/components/brand-home-link';
import { ContentReportDialog, type ContentReportTarget } from '@/components/content-report-dialog';
import { HIDDEN_COMMENT_PLACEHOLDER } from '@/lib/content-reporting';
import { COMMENT_SORTS, parseCommentSort, sortComments, type CommentSort } from '@/lib/comment-sorting';
import { POLLS } from '../../../data/polls';
import { CommentRow, DbPoll } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { getStoredLegacyVoterId } from '@/lib/voter-id';
import { fetchPollVoteIdentity } from '@/lib/poll-vote-identity-request';
import {
  getPollOptionImagePublicUrl,
  normalizeOptionImagePaths,
} from '@/lib/poll-option-image-paths';
import { getStoredPollOwnerToken } from '@/lib/poll-owner-storage';
import { selectNextPolls } from '@/lib/poll-discovery';
import { rememberPollVisit } from '@/lib/poll-discovery-session';
import {
  trackNextPollClicked,
  trackPollViewed,
  trackVoteResultViewed,
  trackVoteSubmitted,
  type VoteResultSource,
} from '@/lib/analytics';

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
  canChangeVote: boolean;
  canCancelVote: boolean;
  managementToken?: string;
  viewerVote?: ViewerVote | null;
  changed?: boolean;
};

type ViewerVote = {
  optionIndex: number;
  canChangeVote: boolean;
  canCancelVote: boolean;
  managementToken?: string;
};

type CancelVoteResponse = {
  id: string;
  votes: number[];
  participants: number;
  viewerVote: ViewerVote | null;
};

type CommentView = CommentRow & {
  parent_id: string | null;
  like_count: number;
  dislike_count: number;
  user_reaction: 'like' | 'dislike' | null;
  is_hidden?: boolean;
};

type PollDetailResponse = {
  poll?: DbPoll | null;
  comments?: CommentView[];
  viewerVote?: ViewerVote | null;
  reportable?: boolean;
  error?: string;
};

type ShareFeedback = {
  type: 'success' | 'error';
  message: string;
};

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

export default function VotePage({ params }: { params: Promise<VotePageParams> }) {
  const { user, profile, openLogin, loading: authLoading } = useAuth();
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  const [commentSort, setCommentSort] = useState<CommentSort>('likes');
  const reactionInFlight = useRef(new Set<string>());
  useEffect(() => {
    const sync = () => setCommentSort(parseCommentSort(new URLSearchParams(window.location.search).get('comments')));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [id]);
  const changeCommentSort = (value: string) => {
    const mode = parseCommentSort(value);
    const url = new URL(window.location.href);
    url.searchParams.set('comments', mode);
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setCommentSort(mode);
  };

  const officialPoll = useMemo(() => POLLS.find((item) => item.id === id), [id]);
  const dbPollId = officialPoll ? `official_${id}` : id;

  const [hasViewerVote, setVoted] = useState(false);
  const [canChangeVote, setCanChangeVote] = useState(false);
  const [canCancelVote, setCanCancelVote] = useState(false);
  const [voteManagementToken, setVoteManagementToken] = useState<string | null>(null);
  const [isRevoting, setIsRevoting] = useState(false);
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const [voteCancelling, setVoteCancelling] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [barWidths, setBarWidths] = useState<number[]>([]);
  const [resultRevealAnimating, setResultRevealAnimating] = useState(false);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [commentIsAnonymous, setCommentIsAnonymous] = useState(false);
  const [replyIsAnonymous, setReplyIsAnonymous] = useState(false);
  const commentInFlight = useRef(false);
  const [commentPending, setCommentPending] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [pollData, setPollData] = useState<ViewPoll | null>(null);
  const [pollLoadError, setPollLoadError] = useState('');
  const [reportable, setReportable] = useState(false);
  const [reportTarget, setReportTarget] = useState<ContentReportTarget | null>(null);
  const [recommendationPool, setRecommendationPool] = useState<DbPoll[]>([]);
  const [recentPollIds, setRecentPollIds] = useState<string[]>([]);
  const [isOfficial, setIsOfficial] = useState(false);
  const [canManagePoll, setCanManagePoll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userFingerprint, setUserFingerprint] = useState('');
  const [voterId, setVoterId] = useState('');
  const [legacyIdLoaded, setLegacyIdLoaded] = useState(false);
  const [viewerContextKey, setViewerContextKey] = useState<string | null>(null);
  const [voteIdentityError, setVoteIdentityError] = useState('');
  const [votePending, setVotePending] = useState(false);
  const voteContextKey = `${dbPollId}:${user?.id ?? 'guest'}`;
  const viewerReady = !authLoading && viewerContextKey === voteContextKey;
  const voted = viewerReady && hasViewerVote;
  const voteControlsDisabled = !viewerReady || Boolean(voteIdentityError) || votePending;
  const currentVoteContextRef = useRef(voteContextKey);
  const voteContextGenerationRef = useRef(0);
  const voteInFlight = useRef<object | null>(null);
  const voteClaimRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null);
  const viewerReadRef = useRef<{
    key: string;
    promise: Promise<{ response: Response; json: PollDetailResponse }>;
  } | null>(null);
  const [syncState, setSyncState] = useState<'live' | 'syncing' | 'reconnecting'>('live');
  const [resultViewSource, setResultViewSource] = useState<VoteResultSource | null>(null);
  const lastSnapshotRef = useRef('');
  const pollRequestGenerationRef = useRef(0);
  const recommendationRequestGenerationRef = useRef(0);
  const trackedPollViewRef = useRef<string | null>(null);
  const trackedResultViewRef = useRef<string | null>(null);
  const silentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultBarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelVoteButtonRef = useRef<HTMLButtonElement | null>(null);
  const keepVoteButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (cancelConfirmationOpen) keepVoteButtonRef.current?.focus();
  }, [cancelConfirmationOpen]);

  useEffect(() => {
    try { setUserFingerprint(getOrCreateFingerprint()); } catch { /* Storage may be unavailable. */ }
    setVoterId(getStoredLegacyVoterId() ?? '');
    setLegacyIdLoaded(true);
  }, []);

  useEffect(() => {
    // Actor/poll changes invalidate outstanding reads and mutations before
    // the new viewer state is loaded, including account-to-guest logout.
    voteContextGenerationRef.current += 1;
    if (currentVoteContextRef.current !== voteContextKey) {
      voteClaimRef.current = null;
      viewerReadRef.current = null;
    }
    currentVoteContextRef.current = voteContextKey;
    pollRequestGenerationRef.current += 1;
    voteInFlight.current = null;
    lastSnapshotRef.current = '';
    setViewerContextKey(null);
    setVoteIdentityError('');
    setVotePending(false);
    setVoteCancelling(false);
    setCancelConfirmationOpen(false);
    setVoted(false);
    setCanChangeVote(false);
    setCanCancelVote(false);
    setVoteManagementToken(null);
    setIsRevoting(false);
    setChoice(null);
    setSelectedOptionIndex(null);
    setResultViewSource(null);
    setResultRevealAnimating(false);
    setActionError('');
    if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
    if (resultBarTimerRef.current) clearTimeout(resultBarTimerRef.current);
    return () => {
      voteContextGenerationRef.current += 1;
      pollRequestGenerationRef.current += 1;
    };
  }, [voteContextKey, authLoading]);

  useEffect(() => {
    pollRequestGenerationRef.current += 1;
    trackedPollViewRef.current = null;
    trackedResultViewRef.current = null;
    setResultViewSource(null);
    return () => { pollRequestGenerationRef.current += 1; };
  }, [dbPollId]);

  useEffect(() => {
    if (officialPoll) {
      setCanManagePoll(false);
      return;
    }

    try {
      setCanManagePoll(Boolean(getStoredPollOwnerToken(id)));
    } catch {
      setCanManagePoll(false);
    }
  }, [id, officialPoll]);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimerRef.current) clearTimeout(shareFeedbackTimerRef.current);
      if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
      if (resultBarTimerRef.current) clearTimeout(resultBarTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const fetchRecommendationPool = async () => {
      const generation = ++recommendationRequestGenerationRef.current;
      try {
        const response = await fetch('/api/polls', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = (await response.json()) as { data?: DbPoll[] };
        if (generation !== recommendationRequestGenerationRef.current) return;
        setRecommendationPool(response.ok ? json.data ?? [] : []);
      } catch (error) {
        if (generation !== recommendationRequestGenerationRef.current) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        setRecommendationPool([]);
      }
    };

    void fetchRecommendationPool();
    const interval = setInterval(() => { void fetchRecommendationPool(); }, 20000);
    return () => {
      recommendationRequestGenerationRef.current += 1;
      clearInterval(interval);
      controller.abort();
    };
  }, []);

  const fetchAllData = useCallback(async (options?: { silent?: boolean }) => {
    if (authLoading || !legacyIdLoaded || voteInFlight.current || currentVoteContextRef.current !== voteContextKey) return;
    const generation = ++pollRequestGenerationRef.current;

    const silent = options?.silent ?? false;
    if (!silent) setLoading(true);
    if (silent) setSyncState('syncing');

    try {
      let claimSucceeded = true;
      if (user?.id || voterId) {
        // The server may attach an existing guest/legacy vote to this actor.
        // No client identity is created; concurrent refreshes share one claim.
        if (voteClaimRef.current?.key !== voteContextKey) {
          voteClaimRef.current = {
            key: voteContextKey,
            promise: fetchPollVoteIdentity(`/api/polls/${dbPollId}/vote/claim`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(voterId ? { voterId } : {}),
            }).then((response) => response.ok).catch(() => false),
          };
        }
        const currentClaim = voteClaimRef.current;
        claimSucceeded = await currentClaim.promise;
        if (generation !== pollRequestGenerationRef.current) return;
        // Failed reconciliation can be retried. A successful viewer read below
        // may still prove browser participation, which is not an identity error.
        if (!claimSucceeded && voteClaimRef.current === currentClaim) voteClaimRef.current = null;
      }
      const readKey = `${voteContextKey}:${commentSort}`;
      if (viewerReadRef.current?.key !== readKey) {
        // Share an outstanding read during effect replays so cookie bootstrap
        // cannot issue competing identities for the same initial viewer.
        const pendingRead = {
          key: readKey,
          promise: fetchPollVoteIdentity(`/api/polls/${dbPollId}?comments=${commentSort}`, {
            // The server establishes the HttpOnly cookie before controls are
            // ready. Only its viewerVote restores a selection, not storage.
            cache: 'no-store',
            headers: {
              ...(userFingerprint ? { 'x-user-fp': userFingerprint } : {}),
              ...(voterId ? { 'x-voter-id': voterId } : {}),
            },
          }).then(async (response) => ({
            response,
            json: (await response.json()) as PollDetailResponse,
          })),
        };
        viewerReadRef.current = pendingRead;
        const clearPendingRead = () => {
          if (viewerReadRef.current === pendingRead) viewerReadRef.current = null;
        };
        void pendingRead.promise.then(clearPendingRead, clearPendingRead);
      }
      const { response, json } = await viewerReadRef.current.promise;
      if (generation !== pollRequestGenerationRef.current) return;
      setViewerContextKey(voteContextKey);

      if (!response.ok) {
        setPollLoadError(response.status === 404
          ? '현재 이 질문을 볼 수 없어요.'
          : '질문을 불러오지 못했어요. 잠시 후 다시 확인해주세요.');
        setPollData(null);
        setComments([]);
        setReportable(false);
        setReportTarget(null);
        setVoted(false);
        setCanChangeVote(false);
        setCanCancelVote(false);
        setVoteManagementToken(null);
        setCancelConfirmationOpen(false);
        setIsRevoting(false);
        setChoice(null);
        setSelectedOptionIndex(null);
        setResultViewSource(null);
        setReplyTargetId(null);
        setBarWidths([]);
        lastSnapshotRef.current = '';
        return;
      }
      setPollLoadError('');

      const dbPoll = json.poll as DbPollWithOfficialFact | null;
      setReportable(Boolean(dbPoll) && json.reportable !== false);
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
          user_name: comment.user_name,
          avatar_url: comment.avatar_url,
          is_anonymous: comment.is_anonymous === true,
          text: comment.text,
          created_at: comment.created_at,
          is_hidden: comment.is_hidden ?? false,
        })),
      });

      if (silent && lastSnapshotRef.current === snapshot) {
        if (claimSucceeded) setVoteIdentityError('');
        setSyncState('live');
        return;
      }
      lastSnapshotRef.current = snapshot;

      let analyticsCategory: string | null = null;
      let analyticsParticipants = 0;

      if (officialPoll) {
        const defaultVotes = statsToVotes(officialPoll.stats, officialPoll.participants);
        const mergedVotes = dbPoll?.votes && dbPoll.votes.length === officialPoll.options.length ? dbPoll.votes : defaultVotes;
        const mergedParticipants = dbPoll?.participants ?? officialPoll.participants;

        setIsOfficial(true);
        setPollData({
          id: dbPollId,
          title: officialPoll.title,
          category: officialPoll.category,
          options: officialPoll.options,
          votes: mergedVotes,
          participants: mergedParticipants,
          officialFact: officialPoll.officialFact,
          optionImagePaths: null,
        });
        setBarWidths(calcPercentages(mergedVotes));
        analyticsCategory = officialPoll.category;
        analyticsParticipants = mergedParticipants;
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
        analyticsCategory = dbPoll.category || '커뮤니티';
        analyticsParticipants = dbPoll.participants || 0;
      } else {
        setPollData(null);
      }

      const visibleOptions = officialPoll?.options ?? dbPoll?.options ?? [];
      const selectedOptionIndex = json.viewerVote?.optionIndex;
      const hasViewerVote = (
        Number.isInteger(selectedOptionIndex)
        && (selectedOptionIndex as number) >= 0
        && (selectedOptionIndex as number) < visibleOptions.length
      );

      if (hasViewerVote) {
        setVoted(true);
        const changeAllowed = json.viewerVote?.canChangeVote === true;
        setCanChangeVote(changeAllowed);
        const cancelAllowed = json.viewerVote?.canCancelVote === true;
        setCanCancelVote(cancelAllowed);
        setVoteManagementToken(json.viewerVote?.managementToken ?? null);
        if (!cancelAllowed) setCancelConfirmationOpen(false);
        if (!changeAllowed) setIsRevoting(false);
        setChoice(visibleOptions[selectedOptionIndex as number]);
        setSelectedOptionIndex(selectedOptionIndex as number);
        setResultViewSource((current) => current ?? 'existing_vote');
      } else {
        setVoted(false);
        setCanChangeVote(false);
        setCanCancelVote(false);
        setVoteManagementToken(null);
        setIsRevoting(false);
        setCancelConfirmationOpen(false);
        setChoice(null);
        setSelectedOptionIndex(null);
        setResultViewSource(null);
      }
      setVoteIdentityError(claimSucceeded || hasViewerVote
        ? ''
        : '기존 투표를 확인하지 못했어요. 잠시 후 다시 확인해주세요.');

      if (
        !silent
        && analyticsCategory
        && trackedPollViewRef.current !== dbPollId
      ) {
        trackedPollViewRef.current = dbPollId;
        trackPollViewed({
          poll_id: id,
          category: analyticsCategory,
          participants: analyticsParticipants,
          viewer_state: hasViewerVote ? 'voted' : 'unvoted',
        });
      }

      setComments(dbComments);
      setReplyTargetId((current) => dbComments.some((comment) => String(comment.id) === current && !comment.is_hidden)
        ? current
        : null);
      setSyncState('live');
    } catch (error) {
      if (generation !== pollRequestGenerationRef.current) return;
      console.error('투표 페이지 로딩 실패:', getErrorMessage(error));
      if (silent) setSyncState('reconnecting');
      // A network/server failure cannot prove that static official content is
      // public. Only an explicit successful response may enable its fallback.
      setPollData(null);
      setComments([]);
      setReportable(false);
      setReportTarget(null);
      lastSnapshotRef.current = '';
      setPollLoadError('질문을 불러오지 못했어요. 잠시 후 다시 확인해주세요.');
    } finally {
      if (generation === pollRequestGenerationRef.current) setLoading(false);
    }
  }, [authLoading, legacyIdLoaded, user?.id, voteContextKey, dbPollId, id, officialPoll, userFingerprint, voterId, commentSort]);

  const scheduleSilentRefresh = useCallback(() => {
    if (silentRefreshTimerRef.current) {
      clearTimeout(silentRefreshTimerRef.current);
    }
    silentRefreshTimerRef.current = setTimeout(() => {
      void fetchAllData({ silent: true });
    }, 400);
  }, [fetchAllData]);

  useEffect(() => {
    void fetchAllData({ silent: Boolean(lastSnapshotRef.current) });
  }, [fetchAllData, user?.id, profile?.avatar_url, profile?.show_avatar]);

  useEffect(() => {
    if (
      !pollData
      || pollData.id !== dbPollId
      || !voted
      || !resultViewSource
      || trackedResultViewRef.current === dbPollId
    ) return;

    trackedResultViewRef.current = dbPollId;
    trackVoteResultViewed({ poll_id: id, source: resultViewSource });
  }, [dbPollId, id, pollData, resultViewSource, voted]);

  useEffect(() => {
    if (!dbPollId) return;

    const channel = supabase
      .channel(`poll-live-${dbPollId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'polls', filter: `id=eq.${dbPollId}` },
        (payload) => {
          const row = payload.new as DbPoll;
          if (payload.eventType === 'DELETE' || (row as DbPoll & { is_hidden?: boolean }).is_hidden) {
            pollRequestGenerationRef.current += 1;
            setPollData(null);
            setComments([]);
            setReportable(false);
            setReportTarget(null);
            setPollLoadError('현재 이 질문을 볼 수 없어요.');
            scheduleSilentRefresh();
            return;
          }
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

  const parentComments = useMemo(() => sortComments(comments, commentSort).filter((comment) => !comment.parent_id), [comments, commentSort]);
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
  const replyCount = comments.length - parentComments.length;
  const reactionCount = comments.reduce(
    (total, comment) => total + comment.like_count + comment.dislike_count,
    0,
  );
  const optionImageUrls = useMemo(() => {
    if (!pollData) return [];
    return pollData.options.map((_, index) => getPollOptionImagePublicUrl(
      supabase,
      pollData.id,
      index,
      pollData.optionImagePaths?.[index],
    ));
  }, [pollData]);

  const loadedPollId = pollData?.id;
  useEffect(() => {
    if (loadedPollId === dbPollId) setRecentPollIds(rememberPollVisit(dbPollId));
  }, [dbPollId, loadedPollId]);

  if (loading) {
    return <div className="min-h-screen bg-canvas dark:bg-canvas flex items-center justify-center text-muted dark:text-muted font-bold text-lg">투표를 불러오는 중...</div>;
  }

  if (!pollData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 text-center dark:bg-canvas">
        <h1 className="text-xl font-bold text-ink dark:text-ink">{pollLoadError || '질문을 찾을 수 없어요.'}</h1>
        <p className="text-sm text-muted dark:text-muted">삭제되었거나 운영 정책에 따라 숨겨진 질문일 수 있습니다.</p>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white">다른 질문 둘러보기</Link>
      </main>
    );
  }

  const selectedPercentage = selectedOptionIndex === null ? 0 : (barWidths[selectedOptionIndex] ?? 0);
  const relatedPolls = selectNextPolls(recommendationPool, pollData, recentPollIds);
  const nextPoll = relatedPolls[0] ?? null;
  const remainingRelatedPolls = voted ? relatedPolls.slice(1) : relatedPolls;

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
    if (voteControlsDisabled || voteInFlight.current || voted) return;
    const requestToken = {};
    const contextGeneration = voteContextGenerationRef.current;
    voteInFlight.current = requestToken;
    pollRequestGenerationRef.current += 1;
    viewerReadRef.current = null;
    setVotePending(true);
    setActionError('');

    try {
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex: idx }),
      });

      const json = (await response.json()) as { data?: IncrementVoteResponse; error?: string };
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      if (response.status === 409) {
        voteInFlight.current = null;
        await fetchAllData({ silent: true });
        return;
      }
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '투표 반영 실패', response.status);
      if (
        json.data.viewerVote === null
        || !Number.isInteger(json.data.optionIndex)
        || json.data.optionIndex < 0
        || json.data.optionIndex >= pollData.options.length
      ) {
        voteInFlight.current = null;
        setIsRevoting(false);
        await fetchAllData({ silent: true });
        return;
      }

      setPollData((prev) => (prev ? { ...prev, votes: json.data!.votes, participants: json.data!.participants } : prev));
      setChoice(pollData.options[json.data.optionIndex] ?? pollData.options[idx]);
      setSelectedOptionIndex(json.data.optionIndex);
      setVoted(true);
      setCanChangeVote(json.data.canChangeVote === true);
      setCanCancelVote(json.data.canCancelVote === true);
      setVoteManagementToken(json.data.managementToken ?? null);
      setResultRevealAnimating(true);
      setBarWidths(pollData.options.map(() => 0));
      if (resultBarTimerRef.current) clearTimeout(resultBarTimerRef.current);
      if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
      const confirmedVotes = json.data.votes;
      resultBarTimerRef.current = setTimeout(() => {
        if (contextGeneration === voteContextGenerationRef.current) setBarWidths(calcPercentages(confirmedVotes));
        resultBarTimerRef.current = null;
      }, 100);
      resultRevealTimerRef.current = setTimeout(() => {
        if (contextGeneration === voteContextGenerationRef.current) setResultRevealAnimating(false);
        resultRevealTimerRef.current = null;
      }, 550);
      trackVoteSubmitted({
        poll_id: id,
        category: pollData.category,
        option_index: json.data.optionIndex,
        vote_action: 'initial',
      });
      setResultViewSource('new_vote');
    } catch (error) {
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      if (error instanceof ApiResponseError && error.status === 401) {
        setActionError('로그인 상태를 확인하지 못했어요. 새로고침 후 다시 시도해주세요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 404) {
        voteInFlight.current = null;
        await fetchAllData({ silent: true });
        return;
      }
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError('요청이 많아요. 잠시 후 다시 시도해주세요.');
      } else {
        setActionError('투표를 반영하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      if (contextGeneration === voteContextGenerationRef.current) {
        if (voteInFlight.current === requestToken) voteInFlight.current = null;
        setVotePending(false);
      }
    }
  };

  const handleRevote = async (idx: number) => {
    if (voteControlsDisabled || !canChangeVote || voteInFlight.current || !voted || selectedOptionIndex === null) return;
    setActionError('');

    if (idx === selectedOptionIndex) {
      setIsRevoting(false);
      return;
    }

    const requestToken = {};
    const contextGeneration = voteContextGenerationRef.current;
    voteInFlight.current = requestToken;
    pollRequestGenerationRef.current += 1;
    viewerReadRef.current = null;
    setVotePending(true);

    try {
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex: idx, managementToken: voteManagementToken }),
      });

      const json = (await response.json()) as { data?: IncrementVoteResponse; error?: string; code?: string };
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      if (response.status === 409) {
        if (json.code === 'VOTE_REQUIRES_ACCOUNT') {
          setIsRevoting(false);
          setCanChangeVote(false);
          setCanCancelVote(false);
          setVoteManagementToken(null);
          setCancelConfirmationOpen(false);
          setActionError('이 브라우저에서 이미 참여했어요. 기존 결과를 확인할 수 있어요.');
          return;
        }
        voteInFlight.current = null;
        setIsRevoting(false);
        await fetchAllData({ silent: true });
        return;
      }
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '투표 변경 실패', response.status);
      if (
        json.data.viewerVote === null
        || !Number.isInteger(json.data.optionIndex)
        || json.data.optionIndex < 0
        || json.data.optionIndex >= pollData.options.length
      ) {
        voteInFlight.current = null;
        setIsRevoting(false);
        await fetchAllData({ silent: true });
        return;
      }

      setPollData((prev) => (prev ? { ...prev, votes: json.data!.votes, participants: json.data!.participants } : prev));
      setChoice(pollData.options[json.data.optionIndex] ?? pollData.options[idx]);
      setSelectedOptionIndex(json.data.optionIndex);
      setCanChangeVote(json.data.canChangeVote === true);
      setCanCancelVote(json.data.canCancelVote === true);
      setVoteManagementToken(json.data.managementToken ?? null);
      setBarWidths(calcPercentages(json.data.votes));
      setIsRevoting(false);
      trackVoteSubmitted({
        poll_id: id,
        category: pollData.category,
        option_index: json.data.optionIndex,
        vote_action: 'change',
      });
    } catch (error) {
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      if (error instanceof ApiResponseError && error.status === 401) {
        setActionError('로그인 상태를 확인하지 못했어요. 새로고침 후 다시 시도해주세요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 404) {
        voteInFlight.current = null;
        await fetchAllData({ silent: true });
        return;
      }
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError('요청이 많아요. 잠시 후 다시 시도해주세요.');
      } else {
        setActionError('선택을 변경하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      if (contextGeneration === voteContextGenerationRef.current) {
        if (voteInFlight.current === requestToken) voteInFlight.current = null;
        setVotePending(false);
      }
    }
  };

  const dismissCancelConfirmation = () => {
    if (votePending) return;
    setCancelConfirmationOpen(false);
    cancelVoteButtonRef.current?.focus();
  };

  const handleCancelVote = async () => {
    if (voteControlsDisabled || !canCancelVote || voteInFlight.current || !voted) return;
    const requestToken = {};
    const contextGeneration = voteContextGenerationRef.current;
    voteInFlight.current = requestToken;
    pollRequestGenerationRef.current += 1;
    viewerReadRef.current = null;
    setVotePending(true);
    setVoteCancelling(true);
    setActionError('');

    try {
      // The server resolves both account and HttpOnly browser participation.
      // This opaque server token binds the already displayed ballot; it does
      // not contain or replace the server-resolved account/browser identity.
      const response = await fetch(`/api/polls/${pollData.id}/vote`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managementToken: voteManagementToken }),
      });
      const json = (await response.json()) as { data?: CancelVoteResponse; error?: string };
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      if (response.status === 409 || response.status === 404) {
        // Another tab may have already removed this vote or hidden the poll.
        voteInFlight.current = null;
        setCancelConfirmationOpen(false);
        await fetchAllData({ silent: true });
        if (contextGeneration === voteContextGenerationRef.current) {
          setActionError('투표 상태가 바뀌었어요. 최신 상태를 확인한 뒤 다시 시도해주세요.');
        }
        return;
      }
      if (!response.ok || !json.data || json.data.id !== pollData.id) {
        throw new ApiResponseError('투표 취소 실패', response.status);
      }

      const updated = json.data;
      const remainingVote = updated.viewerVote;
      const remainingIndex = remainingVote?.optionIndex;
      const hasRemainingVote = Number.isInteger(remainingIndex)
        && (remainingIndex as number) >= 0
        && (remainingIndex as number) < pollData.options.length;

      // Account precedence may reveal another existing browser-linked row.
      // Only the response can determine whether this viewer is now unvoted.
      setPollData((prev) => (prev ? { ...prev, votes: updated.votes, participants: updated.participants } : prev));
      setVoted(hasRemainingVote);
      setChoice(hasRemainingVote ? pollData.options[remainingIndex as number] : null);
      setSelectedOptionIndex(hasRemainingVote ? remainingIndex as number : null);
      setCanChangeVote(hasRemainingVote && remainingVote?.canChangeVote === true);
      setCanCancelVote(hasRemainingVote && remainingVote?.canCancelVote === true);
      setVoteManagementToken(hasRemainingVote ? remainingVote?.managementToken ?? null : null);
      setIsRevoting(false);
      setCancelConfirmationOpen(false);
      setVoteIdentityError('');
      setResultViewSource(hasRemainingVote ? 'existing_vote' : null);
      setResultRevealAnimating(false);
      if (resultBarTimerRef.current) clearTimeout(resultBarTimerRef.current);
      if (resultRevealTimerRef.current) clearTimeout(resultRevealTimerRef.current);
      setBarWidths(calcPercentages(updated.votes));
      lastSnapshotRef.current = '';
      voteClaimRef.current = { key: voteContextKey, promise: Promise.resolve(true) };
    } catch (error) {
      if (contextGeneration !== voteContextGenerationRef.current || voteInFlight.current !== requestToken) return;
      setActionError(error instanceof ApiResponseError && error.status === 429
        ? '요청이 많아요. 잠시 후 다시 시도해주세요.'
        : '투표를 취소하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      if (contextGeneration === voteContextGenerationRef.current) {
        if (voteInFlight.current === requestToken) voteInFlight.current = null;
        setVotePending(false);
        setVoteCancelling(false);
      }
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || commentInFlight.current) return;
    commentInFlight.current = true;
    setCommentPending(true);
    setActionError('');

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText.trim(),
          parentId: null,
          isAnonymous: commentIsAnonymous,
        }),
      });

      const json = (await response.json()) as { data?: CommentView; error?: string };
      if (!response.ok || !json.data) throw new ApiResponseError(json.error ?? '댓글 등록 실패', response.status);

      setComments((prev) => [{ ...json.data!, parent_id: null, like_count: 0, dislike_count: 0, user_reaction: null }, ...prev]);
      setInputText('');
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) {
        openLogin('의견을 남기려면 다시 로그인해주세요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 404) {
        await fetchAllData({ silent: true });
        setActionError('현재 이 질문에 의견을 남길 수 없어요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`댓글 등록 실패: ${getErrorMessage(error)}`);
      }
    } finally { commentInFlight.current = false; setCommentPending(false); }
  };

  const handleReplySubmit = async (parentId: string) => {
    if (!replyText.trim() || commentInFlight.current) return;
    commentInFlight.current = true;
    setCommentPending(true);
    setActionError('');

    try {
      const response = await fetch(`/api/polls/${pollData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: replyText.trim(),
          parentId,
          isAnonymous: replyIsAnonymous,
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
      if (error instanceof ApiResponseError && error.status === 401) {
        openLogin('답글을 남기려면 다시 로그인해주세요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 404) {
        await fetchAllData({ silent: true });
        setActionError('현재 이 의견에 답글을 남길 수 없어요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        alert(`답글 등록 실패: ${getErrorMessage(error)}`);
      }
    } finally { commentInFlight.current = false; setCommentPending(false); }
  };

  const handleReaction = async (commentId: string, reaction: 'like' | 'dislike') => {
    if (reactionInFlight.current.has(commentId)) return;
    reactionInFlight.current.add(commentId);
    setActionError('');
    try {
      const response = await fetch(`/api/comments/${commentId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction }),
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
      if (error instanceof ApiResponseError && error.status === 401) {
        openLogin('의견에 반응하려면 다시 로그인해주세요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 404) {
        await fetchAllData({ silent: true });
        setActionError('현재 이 의견에 반응할 수 없어요.');
        return;
      }
      if (error instanceof ApiResponseError && error.status === 429) {
        setActionError(error.message);
      } else {
        setActionError('반응을 반영하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      reactionInFlight.current.delete(commentId);
    }
  };

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-canvas pb-24 text-ink dark:bg-canvas dark:text-ink">
      <nav className="sticky top-0 z-50 border-b border-line bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex min-w-0 max-w-[1440px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <BrandHomeLink />
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${isOfficial ? 'bg-primary-soft text-link dark:text-link' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}>
              {isOfficial ? '공식 데이터 기반' : '커뮤니티 투표'}
            </span>
            <span className={`hidden rounded-full px-3 py-1 text-xs font-bold sm:inline-flex ${voted ? 'bg-primary text-white' : 'bg-surface-muted text-muted dark:bg-white/10 dark:text-muted'}`}>
              {voted ? '참여 완료' : '투표 진행 중'}
            </span>
            </div>
            <AuthButton />
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1280px] space-y-6 px-4 pt-6 sm:px-6 md:pt-8 lg:px-8">
        <header className="relative overflow-hidden rounded-3xl border border-line bg-hero p-5 md:p-8">
          <div className="relative max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-black text-white">{pollData.category || '기타'}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${voted ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-surface text-muted dark:bg-white/10 dark:text-muted'}`}>
                {voted ? '참여 완료' : '투표 진행 중'}
              </span>
            </div>
            <h1 className="mt-4 break-words text-3xl font-black leading-tight tracking-[-0.035em] text-ink dark:text-ink sm:text-4xl">{pollData.title}</h1>
            <p className="mt-3 text-sm font-medium text-muted dark:text-muted sm:text-base">
              {isRevoting ? '기존 선택을 다른 선택지로 바꿔보세요.' : voted ? '내 선택과 전체 결과를 비교해보세요.' : '당신의 선택은 어느 쪽인가요? 하나를 고르면 바로 결과를 볼 수 있어요.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-muted dark:text-muted">
              <span>참여자 {pollData.participants.toLocaleString()}명</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span>의견 {comments.length}개</span>
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
              <span className={syncState === 'reconnecting' ? 'text-rose-700 dark:text-rose-300' : syncState === 'syncing' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>
                {syncState === 'live' ? '실시간 반영 중' : syncState === 'syncing' ? '결과 동기화 중' : '재연결 중'}
              </span>
              {reportable ? <button type="button" onClick={() => setReportTarget({ type: 'poll', id: dbPollId, label: '질문' })} className="inline-flex min-h-11 items-center rounded-xl px-2 text-xs text-muted hover:text-ink dark:text-muted dark:hover:text-ink" aria-label="이 질문 신고하기">신고</button> : null}
            </div>
          </div>
        </header>

        {actionError ? (
          <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center text-sm font-bold text-amber-700 dark:text-amber-300">
            {actionError}
          </div>
        ) : null}
        {voteIdentityError ? (
          <p role="alert" className="text-center text-sm text-muted">{voteIdentityError}</p>
        ) : null}

        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-busy={votePending || !viewerReady} className="min-w-0 rounded-3xl border border-line bg-surface p-4 shadow-xl shadow-slate-950/[0.04] dark:border-line dark:bg-surface sm:p-6 md:p-8">
            {!viewerReady ? (
              <p role="status" className="py-6 text-center text-sm text-muted">이 브라우저의 투표를 확인하고 있어요...</p>
            ) : voteIdentityError && !voted ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted">투표 상태를 다시 확인한 뒤 선택할 수 있어요.</p>
                <button type="button" onClick={() => void fetchAllData()} className="min-h-11 rounded-xl border border-line px-5 py-3 text-sm font-bold text-link">다시 확인</button>
              </div>
            ) : !voted || (isRevoting && canChangeVote) ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-ink dark:text-ink">{isRevoting ? '선택을 바꿔볼까요?' : '당신의 선택은?'}</h2>
                    <p className="mt-2 text-sm text-muted dark:text-muted">{isRevoting ? '같은 선택지를 누르면 변경 없이 결과로 돌아가요.' : '선택하면 전체 결과를 확인할 수 있어요.'}</p>
                  </div>
                  {isRevoting ? (
                    <button type="button" disabled={voteControlsDisabled} onClick={() => setIsRevoting(false)} className="min-h-11 rounded-xl px-3 text-sm font-bold text-muted hover:text-link disabled:cursor-wait disabled:opacity-60">취소</button>
                  ) : null}
                </div>
                <div className="relative mt-7 grid gap-3 sm:grid-cols-2">
                  {pollData.options.map((option, index) => {
                    const isCurrent = isRevoting && selectedOptionIndex === index;
                    const imageUrl = optionImageUrls[index];
                    return (
                      <button
                        key={`${option}_${index}`}
                        type="button"
                        disabled={voteControlsDisabled}
                        onClick={() => (isRevoting ? handleRevote(index) : handleVote(index))}
                        className={`group w-full min-w-0 overflow-hidden rounded-2xl border text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60 dark:focus-visible:ring-offset-canvas ${imageUrl ? 'flex flex-col p-3' : 'flex min-h-28 items-center justify-between gap-4 p-5'} ${isCurrent ? 'border-primary bg-primary-soft ring-2 ring-primary/20' : 'border-line bg-canvas hover:-translate-y-0.5 hover:border-link hover:bg-primary-soft dark:border-line dark:bg-surface dark:hover:bg-primary-soft'}`}
                      >
                        {imageUrl ? (
                          <span className="relative block aspect-[4/3] max-h-72 w-full overflow-hidden rounded-xl bg-surface-muted dark:bg-surface-muted">
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
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${isCurrent ? 'bg-primary text-white' : 'bg-surface text-link shadow-sm dark:bg-white/10 dark:text-link'}`}>{index + 1}</span>
                            <span className="min-w-0 break-words text-base font-bold text-ink dark:text-ink sm:text-lg">{option}</span>
                          </span>
                          <span className={`hidden shrink-0 text-xs font-black text-link transition dark:text-link sm:inline ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
                            {isCurrent ? '현재 선택 ✓' : '선택 →'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {pollData.options.length === 2 ? (
                    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-xs font-bold tracking-wider text-muted shadow-sm dark:border-line dark:bg-surface-muted dark:text-muted">VS</span>
                  ) : null}
                </div>
                <p className="mt-5 text-center text-xs font-medium text-muted dark:text-muted">{votePending ? '선택을 반영하고 있어요...' : '하나를 고르면 바로 다른 사람들의 선택이 보여요. 투표 후에도 선택을 바꿀 수 있어요.'}
                </p>
              </div>
            ) : (
              <div aria-live="polite">
                <p className="mb-3 text-sm font-bold text-muted dark:text-muted">사람들은 이렇게 골랐어요.</p>
                {!canChangeVote ? <p className="mb-3 text-sm text-muted">이 브라우저에서 이미 참여했어요. 기존 선택의 결과를 확인할 수 있어요.</p> : null}
                <div className="rounded-2xl border border-blue-500/20 bg-primary-soft p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-black text-white">{canChangeVote ? '내 선택' : '이 브라우저의 선택'}</span>
                    <h2 className="mt-3 min-w-0 break-words text-xl font-black text-ink dark:text-ink sm:text-2xl">{choice} ✓</h2>
                    <p className="mt-2 text-sm font-medium text-muted dark:text-muted">총 {pollData.participants.toLocaleString()}명이 참여했어요.</p>
                  </div>
                  <div className="mt-5 shrink-0 border-t border-blue-500/15 pt-4 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
                    <p className="text-5xl font-black tracking-[-0.05em] text-link dark:text-link">{selectedPercentage}%</p>
                    <p className="mt-1 text-sm font-bold text-blue-800 dark:text-blue-200">가 같은 선택을 했어요</p>
                  </div>
                </div>

                <div className="mt-8 space-y-4">
                  {pollData.options.map((option, index) => {
                    const isSelected = selectedOptionIndex === index;
                    const percentage = barWidths[index] ?? 0;
                    const voteCount = pollData.votes[index] ?? 0;
                    const imageUrl = optionImageUrls[index];
                    return (
                      <div key={`${option}_${index}`} className={`rounded-2xl border p-4 sm:p-5 ${isSelected ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-500/10 dark:bg-blue-500/10' : 'border-line bg-slate-50/70 dark:border-line dark:bg-surface-muted'}`}>
                        <div className={imageUrl ? 'grid gap-4 sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)] sm:items-center' : ''}>
                          {imageUrl ? (
                            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-surface-muted dark:bg-surface-muted">
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
                                  <span className={`break-words font-black ${isSelected ? 'text-link dark:text-link' : 'text-ink dark:text-ink'}`}>{option}</span>
                                  {isSelected ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-white">{canChangeVote ? '내 선택 ✓' : '이 브라우저의 선택 ✓'}</span> : null}
                                </div>
                                <p className="mt-1 text-xs font-semibold text-muted">{voteCount.toLocaleString()}표</p>
                              </div>
                              <span className={`text-2xl font-black ${isSelected ? 'text-link dark:text-link' : 'text-ink dark:text-ink'}`}>{percentage}%</span>
                            </div>
                            <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-muted dark:bg-white/10">
                              <div className={`h-full rounded-full ${resultRevealAnimating ? 'transition-[width] duration-500 ease-out motion-reduce:transition-none' : ''} ${isSelected ? 'bg-primary' : 'bg-slate-400 dark:bg-slate-500'}`} style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  {canChangeVote ? <button type="button" disabled={voteControlsDisabled} onClick={() => {
                    setCancelConfirmationOpen(false);
                    setIsRevoting(true);
                  }} className="min-h-11 flex-1 rounded-xl border border-blue-500/40 px-5 py-3 text-sm font-bold text-link transition hover:border-blue-600 hover:bg-primary-soft disabled:cursor-wait disabled:opacity-60 dark:text-link dark:hover:bg-primary-soft">다시 투표하기</button> : null}
                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    disabled={isSharing}
                    aria-label={`${pollData.title} 공유하기`}
                    aria-busy={isSharing}
                    className="min-h-11 flex-1 rounded-xl bg-primary px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
                  >
                    {isSharing ? '공유 준비 중...' : '공유하기'}
                  </button>
                </div>

                {canCancelVote ? (
                  <div className="mt-2">
                    <button
                      ref={cancelVoteButtonRef}
                      type="button"
                      disabled={voteControlsDisabled}
                      aria-expanded={cancelConfirmationOpen}
                      aria-controls="cancel-vote-confirmation"
                      onClick={() => {
                        setActionError('');
                        setCancelConfirmationOpen(true);
                      }}
                      className="min-h-11 rounded-xl px-3 text-sm font-medium text-muted transition hover:text-ink disabled:cursor-wait disabled:opacity-60"
                    >
                      투표 취소
                    </button>
                    {cancelConfirmationOpen ? (
                      <div
                        id="cancel-vote-confirmation"
                        role="group"
                        aria-labelledby="cancel-vote-heading"
                        aria-describedby="cancel-vote-description"
                        aria-busy={voteCancelling}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && !votePending) {
                            event.preventDefault();
                            dismissCancelConfirmation();
                          }
                        }}
                        className="mt-2 rounded-2xl border border-line bg-canvas p-4"
                      >
                        <p id="cancel-vote-heading" className="text-sm font-bold text-ink">투표를 취소할까요?</p>
                        <p id="cancel-vote-description" className="mt-2 text-sm leading-relaxed text-muted">취소하면 이 질문의 참여자 수와 선택 결과에서 내 표가 제외됩니다.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button ref={keepVoteButtonRef} type="button" disabled={votePending} onClick={dismissCancelConfirmation} className="min-h-11 rounded-xl border border-line px-4 text-sm font-bold text-ink disabled:cursor-wait disabled:opacity-60">취소하지 않기</button>
                          <button type="button" disabled={voteControlsDisabled} onClick={() => void handleCancelVote()} className="min-h-11 rounded-xl px-4 text-sm font-bold text-muted hover:text-ink disabled:cursor-wait disabled:opacity-60">{voteCancelling ? '취소 중...' : '투표 취소'}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {nextPoll ? (
                  <div className="mt-8 border-t border-line pt-6 dark:border-line">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-link dark:text-link">하나 더 볼까요?</p>
                    <Link
                      href={`/vote/${nextPoll.id}`}
                      onClick={() => trackNextPollClicked({
                        from_poll_id: id,
                        to_poll_id: nextPoll.id,
                      })}
                      className="group mt-3 flex min-w-0 items-center justify-between gap-4 rounded-2xl border border-line bg-canvas p-4 transition hover:border-link hover:bg-primary-soft dark:border-line dark:bg-surface dark:hover:bg-primary-soft sm:p-5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-muted">다른 사람들은 이것도 궁금해했어요.</p>
                        <h3 className="mt-1 min-w-0 break-words text-base font-bold text-ink dark:text-ink sm:text-lg">{nextPoll.title}</h3>
                        {nextPoll.options.length >= 2 ? (
                          <p className="mt-2 truncate text-xs font-medium text-muted dark:text-muted">{nextPoll.options[0]} <span className="mx-1 font-black text-link">VS</span> {nextPoll.options[1]}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-black text-link transition-transform group-hover:translate-x-1 dark:text-link">골라보기 →</span>
                    </Link>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            {!voted || (canManagePoll && !isOfficial) ? (
            <section className="rounded-3xl border border-line bg-surface p-5 dark:border-line dark:bg-surface">
              <h2 className="text-base font-bold text-ink dark:text-ink">{voted ? '내 투표 관리' : '친구의 선택도 궁금한가요?'}</h2>
              {!voted ? <p className="mt-2 text-sm leading-relaxed text-muted dark:text-muted">질문을 공유하고 서로의 결과를 비교해보세요.</p> : null}
              {!voted ? (
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  disabled={isSharing}
                  aria-label={`${pollData.title} 공유하기`}
                  aria-busy={isSharing}
                  className="mt-4 min-h-11 w-full rounded-xl bg-primary px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/15 transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
                >
                  {isSharing ? '공유 준비 중...' : '공유하기'}
                </button>
              ) : null}
              {canManagePoll && !isOfficial ? (
                <Link
                  href={`/vote/${encodeURIComponent(id)}/edit`}
                  className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-line px-5 py-3 text-sm font-bold text-ink transition hover:border-link hover:bg-primary-soft hover:text-blue-700 dark:border-line dark:text-ink dark:hover:border-blue-400 dark:hover:bg-primary-soft dark:hover:text-blue-200"
                >
                  내 투표 관리
                </Link>
              ) : null}
            </section>
            ) : null}

            {pollData.officialFact ? (
              <section className="rounded-3xl border border-line bg-surface-muted p-5 dark:bg-surface-muted">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-sm font-black text-link dark:text-link">i</span>
                  <h2 className="font-bold text-ink">관련 데이터</h2>
                </div>
                <p className="mt-3 break-keep text-sm font-semibold leading-relaxed text-muted dark:text-muted">{pollData.officialFact}</p>
                <p className="mt-3 text-xs font-medium text-muted">판단을 돕는 참고 정보예요.</p>
              </section>
            ) : null}
          </aside>
        </div>

        <div className="grid items-start gap-8 pt-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 max-w-3xl space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-ink dark:text-ink sm:text-3xl">사람들의 의견</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted dark:text-muted">결과만큼 궁금한 건, 사람들이 그렇게 고른 이유예요.</p>
                <div aria-label="의견 활동" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-muted dark:text-muted">
                  <span>의견 {parentComments.length}개</span>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>답글 {replyCount}개</span>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                  <span>반응 {reactionCount}개</span>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">정렬
                <select aria-label="의견 정렬" value={commentSort} onChange={event => changeCommentSort(event.target.value)} className="min-h-11 max-w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink">
                  {Object.entries(COMMENT_SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <form onSubmit={handleCommentSubmit} aria-busy={commentPending} className="border-y border-line py-5 dark:border-line">
              <label htmlFor="comment-input" className="text-sm font-bold text-ink dark:text-ink">왜 그렇게 골랐는지 알려주세요.</label>
              <p id="comment-input-help" className="mt-1 text-xs leading-relaxed text-muted dark:text-muted">다른 사람들과 선택한 이유를 나눠보세요.</p>
              <textarea
                id="comment-input"
                aria-describedby="comment-input-help"
                rows={3}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                className="mt-3 w-full resize-none rounded-xl border border-line bg-surface p-4 text-sm font-medium leading-relaxed text-ink outline-none transition placeholder:text-muted focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted dark:text-ink"
                placeholder="선택한 이유를 남겨주세요."
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {user ? (
                  <div className="min-w-0">
                    <label htmlFor="comment-anonymous" className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                      <input id="comment-anonymous" type="checkbox" checked={commentIsAnonymous} onChange={(event) => setCommentIsAnonymous(event.target.checked)} aria-describedby="comment-author-display" className="h-4 w-4 shrink-0 accent-blue-600" />
                      익명으로 작성
                    </label>
                    <p id="comment-author-display" className="break-words text-xs text-muted" aria-live="polite">{commentIsAnonymous ? '이 질문에서만 쓰는 익명 별명으로 작성돼요.' : `공개 이름: ${profile?.nickname ?? '닉네임 확인 중...'}`}</p>
                  </div>
                ) : <p className="text-xs text-muted">익명으로 댓글이 작성돼요.</p>}
                <button type="submit" disabled={commentPending} className="min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-canvas">{commentPending ? '등록 중...' : '의견 남기기'}</button>
              </div>
            </form>

            {parentComments.length === 0 ? (
              <div className="border-y border-dashed border-line py-10 text-center dark:border-line">
                <p className="text-sm font-bold text-ink dark:text-ink">아직 의견이 없어요.</p>
                <p className="mt-1 text-sm text-muted dark:text-muted">첫 번째 이유를 남겨볼까요?</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border-y border-line dark:divide-white/10 dark:border-line">
                {parentComments.map((comment) => (
                  <article key={comment.id} id={`comment-${comment.id}`} className="scroll-mt-20 py-6 first:pt-5 last:pb-5 sm:px-1">
                    {!comment.is_hidden ? <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2"><ProfileAvatar name={comment.displayName || comment.user_name || '익명'} url={comment.is_anonymous ? null : comment.avatar_url} /><span className="min-w-0 break-words text-xs font-bold text-link">{comment.displayName || comment.user_name || '익명 사용자'}</span></div>
                      <time className="shrink-0 text-xs font-semibold text-muted dark:text-muted">{new Date(comment.created_at).toLocaleDateString('ko-KR')}</time>
                    </div> : null}
                    <p className={`mt-3 max-w-[70ch] whitespace-pre-wrap break-words text-[15px] font-medium leading-7 ${comment.is_hidden ? 'text-muted dark:text-muted' : 'text-ink dark:text-ink'}`}>{comment.is_hidden ? HIDDEN_COMMENT_PLACEHOLDER : comment.text}</p>

                    {!comment.is_hidden ? <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                      <button type="button" aria-pressed={comment.user_reaction === 'like'} onClick={() => handleReaction(String(comment.id), 'like')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas ${comment.user_reaction === 'like' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-line text-muted hover:border-emerald-400 dark:border-line dark:text-muted'}`}><span>좋아요</span><span>{comment.like_count}</span>{comment.user_reaction === 'like' ? <span aria-hidden="true">✓</span> : null}</button>
                      <button type="button" aria-pressed={comment.user_reaction === 'dislike'} onClick={() => handleReaction(String(comment.id), 'dislike')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas ${comment.user_reaction === 'dislike' ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-line text-muted hover:border-rose-400 dark:border-line dark:text-muted'}`}><span>싫어요</span><span>{comment.dislike_count}</span>{comment.user_reaction === 'dislike' ? <span aria-hidden="true">✓</span> : null}</button>
                      <button type="button" aria-expanded={replyTargetId === String(comment.id)} aria-controls={`reply-editor-${comment.id}`} onClick={() => setReplyTargetId(replyTargetId === String(comment.id) ? null : String(comment.id))} className="min-h-10 rounded-xl border border-line px-3 py-1.5 font-bold text-muted transition hover:border-link hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:border-line dark:text-muted dark:focus-visible:ring-offset-canvas">{replyTargetId === String(comment.id) ? '답글 닫기' : '답글'}</button>
                      <button type="button" onClick={() => setReportTarget({ type: 'comment', id: String(comment.id), label: '의견' })} aria-label="이 의견 신고하기" className="min-h-11 rounded-xl px-3 text-muted hover:text-ink dark:text-muted dark:hover:text-ink">신고</button>
                    </div> : null}

                    {!comment.is_hidden && replyTargetId === String(comment.id) ? (
                      <div id={`reply-editor-${comment.id}`} className="mt-4 min-w-0 border-l-2 border-blue-500/25 pl-3">
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                          <label htmlFor={`reply-input-${comment.id}`} className="sr-only">답글 내용</label>
                          <input id={`reply-input-${comment.id}`} value={replyText} onChange={(event) => setReplyText(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted" placeholder="짧게 답글을 남겨보세요." />
                          <button type="button" disabled={commentPending} aria-busy={commentPending} onClick={() => void handleReplySubmit(String(comment.id))} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-xs font-black text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-canvas">{commentPending ? '등록 중...' : '답글 남기기'}</button>
                        </div>
                        {user ? <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          <label htmlFor={`reply-anonymous-${comment.id}`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                            <input id={`reply-anonymous-${comment.id}`} type="checkbox" checked={replyIsAnonymous} onChange={(event) => setReplyIsAnonymous(event.target.checked)} aria-describedby={`reply-author-display-${comment.id}`} className="h-4 w-4 shrink-0 accent-blue-600" />
                            익명으로 작성
                          </label>
                          <p id={`reply-author-display-${comment.id}`} className="min-w-0 break-words text-xs text-muted" aria-live="polite">{replyIsAnonymous ? '이 질문에서만 쓰는 익명 별명으로 작성돼요.' : `공개 이름: ${profile?.nickname ?? '닉네임 확인 중...'}`}</p>
                        </div> : <p className="mt-2 text-xs text-muted">익명으로 답글이 작성돼요.</p>}
                      </div>
                    ) : null}

                    {(repliesByParent.get(String(comment.id)) ?? []).length > 0 ? (
                      <div className="mt-5 divide-y divide-slate-200 border-l-2 border-blue-500/20 pl-3 dark:divide-white/10 sm:pl-5">
                        {(repliesByParent.get(String(comment.id)) ?? []).map((reply) => (
                          <div key={reply.id} id={`comment-${reply.id}`} className="scroll-mt-20 py-4 first:pt-1 last:pb-1">
                            {!reply.is_hidden ? <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2"><ProfileAvatar name={reply.displayName || reply.user_name || '익명'} url={reply.is_anonymous ? null : reply.avatar_url} size={24} /><span className="min-w-0 break-words text-xs font-bold text-link">답글 · {reply.displayName || reply.user_name || '익명 사용자'}</span></div>
                              <time className="shrink-0 text-xs font-semibold text-muted dark:text-muted">{new Date(reply.created_at).toLocaleDateString('ko-KR')}</time>
                            </div> : null}
                            <p className={`mt-2 max-w-[68ch] whitespace-pre-wrap break-words text-sm font-medium leading-6 ${reply.is_hidden ? 'text-muted dark:text-muted' : 'text-ink dark:text-muted'}`}>{reply.is_hidden ? HIDDEN_COMMENT_PLACEHOLDER : reply.text}</p>
                            {!reply.is_hidden ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                              <button type="button" aria-pressed={reply.user_reaction === 'like'} onClick={() => handleReaction(String(reply.id), 'like')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas ${reply.user_reaction === 'like' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-line text-muted hover:border-emerald-400 dark:border-line dark:text-muted'}`}><span>좋아요</span><span>{reply.like_count}</span>{reply.user_reaction === 'like' ? <span aria-hidden="true">✓</span> : null}</button>
                              <button type="button" aria-pressed={reply.user_reaction === 'dislike'} onClick={() => handleReaction(String(reply.id), 'dislike')} className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-link focus-visible:ring-offset-2 dark:focus-visible:ring-offset-canvas ${reply.user_reaction === 'dislike' ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'border-line text-muted hover:border-rose-400 dark:border-line dark:text-muted'}`}><span>싫어요</span><span>{reply.dislike_count}</span>{reply.user_reaction === 'dislike' ? <span aria-hidden="true">✓</span> : null}</button>
                              <button type="button" onClick={() => setReportTarget({ type: 'comment', id: String(reply.id), label: '답글' })} aria-label="이 답글 신고하기" className="min-h-11 rounded-xl px-3 text-muted hover:text-ink dark:text-muted dark:hover:text-ink">신고</button>
                            </div> : null}
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
              <h2 className="text-xl font-bold text-ink dark:text-ink">이 투표도 해보세요</h2>
              <p className="mt-1 text-sm text-muted dark:text-muted">같은 관심사와 인기 투표를 모았어요.</p>
            </div>
            {remainingRelatedPolls.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-line p-6 text-sm text-muted dark:border-line">
                다른 질문은 <Link href="/" className="font-black text-link dark:text-link">홈에서 둘러보세요.</Link>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                {remainingRelatedPolls.map((poll) => (
                  <Link key={poll.id} href={`/vote/${poll.id}`} className="group rounded-2xl border border-line bg-surface p-5 transition hover:border-link hover:shadow-lg hover:shadow-blue-950/5 dark:border-line dark:bg-surface">
                    <div className="flex items-center justify-between gap-2 text-xs font-bold">
                      <span className="text-link dark:text-link">{poll.category || '커뮤니티'}</span>
                      {poll.category === pollData.category ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-link dark:text-link">같은 카테고리</span> : null}
                    </div>
                    <h3 className="mt-3 break-words font-bold leading-snug text-ink dark:text-ink">{poll.title}</h3>
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs dark:border-line">
                      <span className="font-bold text-muted">참여자 {(poll.participants ?? 0).toLocaleString()}명</span>
                      <span className="font-black text-link transition-transform group-hover:translate-x-1 dark:text-link">투표하기 →</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>

      <ContentReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />

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
