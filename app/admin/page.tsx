'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { AdminReportQueue } from '@/components/admin-report-queue';

type AdminPoll = {
  id: string;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
  official_fact?: string | null;
  created_at?: string;
  is_hidden?: boolean;
};

const ADMIN_KEY_STORAGE = 'dh_admin_key';

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [authorizedKey, setAuthorizedKey] = useState('');
  const [tab, setTab] = useState<'reports' | 'polls'>('reports');
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [polls, setPolls] = useState<AdminPoll[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; category: string; optionsCsv: string; officialFact: string }>({
    title: '',
    category: '',
    optionsCsv: '',
    officialFact: '',
  });

  useEffect(() => {
    try {
      // Remove the previous permanent credential without reusing it.
      localStorage.removeItem(ADMIN_KEY_STORAGE);
      setAdminKey(sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '');
    } catch {
      // Administration still works in memory when browser storage is blocked.
    }
  }, []);

  const filteredPolls = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return polls;
    return polls.filter((p) => `${p.id} ${p.title} ${p.category}`.toLowerCase().includes(q));
  }, [polls, query]);

  const fetchPolls = async (key = adminKey) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/polls', {
        headers: { 'x-admin-key': key },
        cache: 'no-store',
      });
      const json = (await response.json()) as { data?: AdminPoll[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? '관리자 조회 실패');
      setPolls(json.data ?? []);
      setAuthorizedKey(key);
      try { sessionStorage.setItem(ADMIN_KEY_STORAGE, key); } catch { /* In-memory credential remains usable. */ }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPolls([]);
      setAuthorizedKey('');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (poll: AdminPoll) => {
    setEditingId(poll.id);
    setDraft({
      title: poll.title,
      category: poll.category,
      optionsCsv: poll.options.join(', '),
      officialFact: poll.official_fact ?? '',
    });
  };

  const saveEdit = async (poll: AdminPoll) => {
    if (mutatingId || poll.is_hidden) return;
    setMutatingId(poll.id);
    setError('');
    try {
    const options = draft.optionsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const response = await fetch(`/api/admin/polls/${encodeURIComponent(poll.id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': authorizedKey,
      },
      body: JSON.stringify({
        title: draft.title,
        category: draft.category,
        options,
        votes: poll.votes,
        official_fact: draft.officialFact,
      }),
    });

    const json = (await response.json()) as { data?: AdminPoll; error?: string };
    if (!response.ok) {
      setError(json.error ?? '수정 실패');
      return;
    }

    setPolls((prev) => prev.map((row) => (row.id === poll.id ? { ...row, ...(json.data ?? {}) } : row)));
    setEditingId(null);
    } catch { setError('수정하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { setMutatingId(null); }
  };

  const deletePoll = async (poll: AdminPoll) => {
    if (mutatingId) return;
    const ok = confirm(`정말 삭제할까요?\n${poll.title}\n(댓글/반응도 함께 삭제됩니다)`);
    if (!ok) return;
    setMutatingId(poll.id);
    setError('');
    try {

    const response = await fetch(`/api/admin/polls/${encodeURIComponent(poll.id)}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': authorizedKey },
    });

    const json = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok) {
      setError(json.error ?? '삭제 실패');
      return;
    }

    setPolls((prev) => prev.filter((row) => row.id !== poll.id));
    } catch { setError('삭제하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    finally { setMutatingId(null); }
  };

  const togglePollVisibility = async (poll: AdminPoll) => {
    if (mutatingId) return;
    setMutatingId(poll.id); setError('');
    try {
      const response = await fetch(`/api/admin/reports/${poll.is_hidden ? 'restore' : 'hide'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': authorizedKey },
        body: JSON.stringify({ targetType: 'poll', targetId: poll.id }),
      });
      const json = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error ?? '공개 상태를 변경하지 못했습니다.');
      setPolls((previous) => previous.map((row) => row.id === poll.id ? { ...row, is_hidden: !poll.is_hidden } : row));
      setEditingId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '공개 상태를 변경하지 못했습니다.'); }
    finally { setMutatingId(null); }
  };

  return (
    <main className="min-h-screen w-full min-w-0 bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center text-sm font-bold hover:text-blue-500">← 홈으로</Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-bold tracking-wider text-slate-600 dark:text-slate-400 sm:inline">ADMIN PANEL</span>
            <ThemeToggle />
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-6 space-y-4">
          <h1 className="text-2xl font-bold">콘텐츠 관리</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">관리자 키로 신고를 검토하고 질문을 관리합니다. 키는 이 탭의 세션 동안만 저장됩니다.</p>
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              type="password"
              aria-label="관리자 키"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="관리자 키"
              className="min-w-0 flex-1 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10"
            />
            <button onClick={() => void fetchPolls()} disabled={loading} className="min-h-11 px-4 py-3 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-50">
              {loading ? '확인 중...' : '관리자 확인'}
            </button>
          </div>
          {tab === 'polls' ? <input
            type="text"
            aria-label="질문 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="id / 제목 / 카테고리 검색"
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10"
          /> : null}
          <div aria-live="polite">{error ? <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}</div>
        </section>

        <div className="flex gap-2" role="group" aria-label="관리 목록">
          <button type="button" aria-pressed={tab === 'reports'} onClick={() => setTab('reports')} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab === 'reports' ? 'bg-blue-600 text-white' : 'border border-slate-300 dark:border-white/15'}`}>신고</button>
          <button type="button" aria-pressed={tab === 'polls'} onClick={() => { setTab('polls'); if (authorizedKey) void fetchPolls(authorizedKey); }} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab === 'polls' ? 'bg-blue-600 text-white' : 'border border-slate-300 dark:border-white/15'}`}>질문</button>
        </div>
        {!authorizedKey ? <p className="text-sm text-slate-600 dark:text-slate-400">관리자 키를 입력하고 확인해주세요.</p> : null}
        {authorizedKey && tab === 'reports' ? <AdminReportQueue adminKey={authorizedKey} /> : null}

        {authorizedKey && tab === 'polls' ? <section className="space-y-3" aria-busy={!!mutatingId}>
          {loading ? <p className="text-sm text-slate-500 font-bold">불러오는 중...</p> : null}
          {filteredPolls.map((poll) => {
            const editing = editingId === poll.id;
            return (
              <article key={poll.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-xs text-slate-500 dark:text-slate-400">{poll.id} · {poll.is_hidden ? '숨김' : '공개'}</p>
                    <p className="break-words text-lg font-bold">{poll.title}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={!!mutatingId} onClick={() => void togglePollVisibility(poll)} className="min-h-11 px-3 text-xs rounded-xl border border-slate-300 disabled:opacity-50 dark:border-white/15">{poll.is_hidden ? '복구' : '숨기기'}</button>
                    {!editing ? (
                      <button disabled={!!mutatingId || poll.is_hidden} onClick={() => startEdit(poll)} className="min-h-11 px-3 text-xs rounded-xl border border-slate-300 disabled:opacity-50 dark:border-white/15">수정</button>
                    ) : (
                      <>
                        <button disabled={!!mutatingId} onClick={() => void saveEdit(poll)} className="min-h-11 px-3 text-xs rounded-xl bg-emerald-600 text-white disabled:opacity-50">저장</button>
                        <button disabled={!!mutatingId} onClick={() => setEditingId(null)} className="min-h-11 px-3 text-xs rounded-xl border border-slate-300 disabled:opacity-50 dark:border-white/15">취소</button>
                      </>
                    )}
                    <button disabled={!!mutatingId} onClick={() => void deletePoll(poll)} className="min-h-11 px-3 text-xs rounded-xl bg-rose-600 text-white disabled:opacity-50">삭제</button>
                  </div>
                </div>

                {!editing ? (
                  <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                    <p><span className="font-black">카테고리:</span> {poll.category}</p>
                    <p><span className="font-black">참여자:</span> {poll.participants}</p>
                    <p><span className="font-black">선택지:</span> {poll.options.join(' / ')}</p>
                    {poll.official_fact ? <p><span className="font-black">오피셜 팩트:</span> {poll.official_fact}</p> : null}
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 gap-3">
                    <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10" />
                    <input value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10" />
                    <input value={draft.optionsCsv} onChange={(e) => setDraft((d) => ({ ...d, optionsCsv: e.target.value }))} className="md:col-span-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10" placeholder="선택지1, 선택지2, 선택지3" />
                    <textarea value={draft.officialFact} onChange={(e) => setDraft((d) => ({ ...d, officialFact: e.target.value }))} className="md:col-span-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 min-h-20" />
                  </div>
                )}
              </article>
            );
          })}
          {!loading && filteredPolls.length === 0 ? <p className="text-sm text-slate-500">표시할 논제가 없습니다.</p> : null}
        </section> : null}
      </div>
    </main>
  );
}
