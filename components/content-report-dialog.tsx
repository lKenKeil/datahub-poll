'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { REPORT_REASONS, REPORT_DETAIL_MAX_LENGTH, type ReportReason, type ReportTargetType } from '@/lib/content-reporting';
import { getOrCreateReporterId } from '@/lib/report-reporter-id';
import { getUnicodeCodePointLength } from '@/lib/unicode-length';
import { hasUnsafeInputControlCharacters } from '@/lib/public-api-hardening';

export type ContentReportTarget = {
  type: ReportTargetType;
  id: string;
  label: '질문' | '의견' | '답글';
};

export function ContentReportDialog({
  target,
  onClose,
}: {
  target: ContentReportTarget | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const detailId = useId();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target) {
      setReason('spam');
      setDetail('');
      setError('');
      setSuccess('');
      previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [target]);

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || submitting || success) return;
    const safeDetail = reason === 'other' ? detail.trim() : '';
    if (getUnicodeCodePointLength(safeDetail) > REPORT_DETAIL_MAX_LENGTH) {
      setError('설명은 300자 이하로 입력해주세요.');
      return;
    }
    if (hasUnsafeInputControlCharacters(safeDetail)) {
      setError('설명에 사용할 수 없는 문자가 포함되어 있습니다.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: target.type,
          targetId: target.id,
          reporterId: getOrCreateReporterId(),
          reason,
          ...(safeDetail ? { detail: safeDetail } : {}),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        duplicate?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        setError(response.status === 404
          ? '현재 신고할 수 없는 콘텐츠입니다.'
          : response.status === 429
            ? '신고 요청이 많아요. 잠시 후 다시 시도해주세요.'
            : response.status === 400
              ? '신고 내용을 확인해주세요.'
              : '신고를 접수하지 못했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      setSuccess(result.duplicate
        ? '이미 신고한 콘텐츠입니다. 운영자가 확인할게요.'
        : '신고를 접수했어요. 운영자가 확인할게요.');
    } catch {
      setError('신고를 접수하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => { if (submitting) event.preventDefault(); }}
      onClose={() => {
        onClose();
        previouslyFocusedRef.current?.focus();
      }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/60 dark:border-white/15 dark:bg-slate-900 dark:text-white sm:p-6"
    >
      <form onSubmit={submitReport} aria-busy={submitting} className="space-y-4">
        <div>
          <h2 id={titleId} className="text-xl font-bold">{target?.label ?? '콘텐츠'} 신고</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">문제 콘텐츠를 알려주세요. 검토 후 운영 정책에 따라 처리합니다.</p>
        </div>
        {success ? (
          <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">{success}</p>
        ) : (
          <>
            <fieldset disabled={submitting} className="space-y-1">
              <legend className="mb-2 text-sm font-bold">신고 사유</legend>
              {REPORT_REASONS.map((item) => (
                <label key={item.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 dark:hover:bg-white/5">
                  <input type="radio" name="report-reason" value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} className="h-4 w-4 accent-blue-600" />
                  {item.label}
                </label>
              ))}
            </fieldset>
            {reason === 'other' ? (
              <div>
                <label htmlFor={detailId} className="text-sm font-bold">설명 <span className="font-normal text-slate-500 dark:text-slate-400">(선택)</span></label>
                <textarea id={detailId} value={detail} onChange={(event) => setDetail(event.target.value)} disabled={submitting} rows={3} aria-describedby={`${detailId}-help`} className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-transparent p-3 text-sm dark:border-white/20" placeholder="신고 이유를 짧게 알려주세요." />
                <p id={`${detailId}-help`} className="mt-1 text-xs text-slate-600 dark:text-slate-400">300자 이하 · 연락처나 개인정보는 적지 마세요.</p>
              </div>
            ) : null}
          </>
        )}
        {error ? <p role="alert" className="text-sm font-medium text-rose-600 dark:text-rose-300">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeDialog} disabled={submitting} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:opacity-50 dark:border-white/20">{success ? '닫기' : '취소'}</button>
          {!success ? <button type="submit" disabled={submitting} className="min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{submitting ? '접수 중...' : '신고하기'}</button> : null}
        </div>
      </form>
    </dialog>
  );
}
