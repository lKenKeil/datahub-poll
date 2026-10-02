'use client';

import { useCallback, useEffect, useState } from 'react';
import { REPORT_REASONS, type ContentReportQueueItem, type ModerationAction, type ReportQueueStatus } from '@/lib/content-reporting';

type Props = { adminKey: string };
const actionLabels: Record<ModerationAction, string> = {
  hide: '숨기기', restore: '복구', delete: '삭제', resolve: '처리 완료', dismiss: '기각',
};

export function AdminReportQueue({ adminKey }: Props) {
  const [items, setItems] = useState<ContentReportQueueItem[]>([]);
  const [status, setStatus] = useState<ReportQueueStatus>('pending');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadQueue = useCallback(async () => {
    if (!adminKey) { setItems([]); return; }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/reports?status=${status}&offset=${offset}`, {
        headers: { 'x-admin-key': adminKey }, cache: 'no-store',
      });
      const json = await response.json() as { data?: ContentReportQueueItem[]; hasMore?: boolean; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error ?? '신고 목록을 불러오지 못했습니다.');
      setItems(json.data);
      setHasMore(Boolean(json.hasMore));
    } catch (cause) {
      setItems([]);
      setHasMore(false);
      setError(cause instanceof Error ? cause.message : '신고 목록을 불러오지 못했습니다.');
    } finally { setLoading(false); }
  }, [adminKey, offset, status]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const act = async (item: ContentReportQueueItem, action: ModerationAction) => {
    const targetKey = `${item.target_type}:${item.target_id}`;
    if (busyTarget) return;
    if (action === 'delete') {
      const impact = item.target_type === 'poll'
        ? '이 질문의 의견·반응·투표·이미지가 함께 삭제됩니다.'
        : `이 의견과 하위 답글 ${item.preview.reply_count}개, 관련 반응이 함께 삭제됩니다.`;
      if (!window.confirm(`${impact}\n이 작업은 되돌릴 수 없습니다. 삭제할까요?`)) return;
    }
    setBusyTarget(targetKey);
    setError(''); setFeedback('');
    try {
      const response = await fetch(`/api/admin/reports/${action}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ targetType: item.target_type, targetId: item.target_id }),
      });
      const json = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error ?? '요청을 처리하지 못했습니다.');
      setFeedback(`${actionLabels[action]} 처리했습니다.`);
      await loadQueue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.');
    } finally { setBusyTarget(null); }
  };

  return (
    <section className="min-w-0 space-y-4" aria-busy={loading || busyTarget !== null}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          신고 상태
          <select value={status} onChange={(event) => { setStatus(event.target.value as ReportQueueStatus); setOffset(0); }} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 dark:border-white/15 dark:bg-slate-900">
            <option value="pending">미처리</option><option value="handled">처리됨</option><option value="all">전체</option>
          </select>
        </label>
        <button type="button" onClick={() => void loadQueue()} disabled={loading || !!busyTarget} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-white/15">새로고침</button>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">신고는 자동으로 콘텐츠를 숨기지 않습니다. 대상별 신고 건수를 확인하고 직접 처리해주세요.</p>
      <div aria-live="polite" className="text-sm">
        {error ? <p role="alert" className="text-rose-600 dark:text-rose-400">{error}</p> : null}
        {feedback ? <p className="text-blue-600 dark:text-blue-300">{feedback}</p> : null}
      </div>
      {loading ? <p className="text-sm text-slate-500">신고를 불러오는 중...</p> : null}
      {!loading && !error && items.length === 0 ? <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-400">이 상태의 신고가 없습니다.</p> : null}
      {items.map((item) => {
        const targetKey = `${item.target_type}:${item.target_id}`;
        const targetLabel = item.target_type === 'poll' ? '질문' : item.preview.parent_id ? '답글' : '의견';
        const currentState = !item.preview.exists ? '삭제됨' : item.preview.is_hidden ? '숨김' : '공개';
        return (
          <article key={targetKey} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-bold">{targetLabel} · {currentState}</p>
              <p className="text-slate-600 dark:text-slate-400">미처리 {item.pending_count}건 / 전체 {item.total_count}건</p>
            </div>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">{item.target_id}</p>
            {item.preview.poll_title && item.target_type === 'comment' ? <p className="break-words text-sm text-slate-600 dark:text-slate-300">질문: {item.preview.poll_title}</p> : null}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{item.preview.text ?? '삭제된 콘텐츠입니다.'}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              {item.reasons.map(({ reason, count }) => <span key={reason}>{REPORT_REASONS.find((value) => value.value === reason)?.label ?? reason} {count}건</span>)}
            </p>
            {item.details?.map((detail, index) => <p key={`${detail.created_at}:${index}`} className="whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-3 text-sm text-slate-600 dark:border-white/15 dark:text-slate-300">추가 설명: {detail.detail}</p>)}
            <p className="text-xs text-slate-500 dark:text-slate-400">최근 신고: {new Date(item.latest_report_at).toLocaleString('ko-KR')}{item.action ? ` · 처리: ${item.action === 'no_action' ? '조치 없이 완료' : actionLabels[item.action]}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              {item.preview.exists ? <>
                <button type="button" disabled={!!busyTarget} onClick={() => void act(item, item.preview.is_hidden ? 'restore' : 'hide')} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:opacity-50 dark:border-white/15">{item.preview.is_hidden ? '복구' : '숨기기'}</button>
                <button type="button" disabled={!!busyTarget} onClick={() => void act(item, 'delete')} className="min-h-11 rounded-xl border border-rose-300 px-4 text-sm font-medium text-rose-600 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-400">삭제</button>
              </> : null}
              {item.pending_count > 0 ? <>
                <button type="button" disabled={!!busyTarget} onClick={() => void act(item, 'resolve')} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-white/15">처리 완료</button>
                <button type="button" disabled={!!busyTarget} onClick={() => void act(item, 'dismiss')} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-white/15">기각</button>
              </> : null}
            </div>
          </article>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <button type="button" disabled={offset === 0 || loading || !!busyTarget} onClick={() => setOffset((value) => Math.max(0, value - 50))} className="min-h-11 rounded-xl px-4 text-sm disabled:opacity-40">이전</button>
        <button type="button" disabled={!hasMore || loading || !!busyTarget} onClick={() => setOffset((value) => value + 50)} className="min-h-11 rounded-xl px-4 text-sm disabled:opacity-40">다음</button>
      </div>
    </section>
  );
}
