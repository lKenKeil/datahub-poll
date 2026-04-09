'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type AdminPoll = {
  id: string;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
  official_fact?: string | null;
  created_at?: string;
};

const ADMIN_KEY_STORAGE = 'dh_admin_key';

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
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
    const saved = localStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
    setAdminKey(saved);
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
      localStorage.setItem(ADMIN_KEY_STORAGE, key);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPolls([]);
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
    const options = draft.optionsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const response = await fetch(`/api/admin/polls/${poll.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
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
      alert(json.error ?? '수정 실패');
      return;
    }

    setPolls((prev) => prev.map((row) => (row.id === poll.id ? { ...row, ...(json.data ?? {}) } : row)));
    setEditingId(null);
  };

  const deletePoll = async (poll: AdminPoll) => {
    const ok = confirm(`정말 삭제할까요?\n${poll.title}\n(댓글/반응도 함께 삭제됩니다)`);
    if (!ok) return;

    const response = await fetch(`/api/admin/polls/${poll.id}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': adminKey },
    });

    const json = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok) {
      alert(json.error ?? '삭제 실패');
      return;
    }

    setPolls((prev) => prev.filter((row) => row.id !== poll.id));
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-200 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm font-bold hover:text-blue-500">← 홈으로</Link>
          <span className="text-xs font-black tracking-wider text-slate-500">ADMIN PANEL</span>
        </div>

        <section className="rounded-3xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-6 space-y-4">
          <h1 className="text-2xl font-black">논제 관리</h1>
          <p className="text-sm text-slate-500">`ADMIN_DASHBOARD_KEY`를 입력하면 수정/삭제 가능합니다.</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="관리자 키"
              className="flex-1 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10"
            />
            <button onClick={() => void fetchPolls()} className="px-4 py-3 rounded-2xl bg-blue-600 text-white font-bold">
              불러오기
            </button>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="id / 제목 / 카테고리 검색"
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10"
          />
          {error ? <p className="text-sm text-rose-500 font-bold">{error}</p> : null}
        </section>

        <section className="space-y-3">
          {loading ? <p className="text-sm text-slate-500 font-bold">불러오는 중...</p> : null}
          {filteredPolls.map((poll) => {
            const editing = editingId === poll.id;
            return (
              <article key={poll.id} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">{poll.id}</p>
                    <p className="text-lg font-black">{poll.title}</p>
                  </div>
                  <div className="flex gap-2">
                    {!editing ? (
                      <button onClick={() => startEdit(poll)} className="px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-white/15">수정</button>
                    ) : (
                      <>
                        <button onClick={() => void saveEdit(poll)} className="px-3 py-2 text-xs rounded-xl bg-emerald-600 text-white">저장</button>
                        <button onClick={() => setEditingId(null)} className="px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-white/15">취소</button>
                      </>
                    )}
                    <button onClick={() => void deletePoll(poll)} className="px-3 py-2 text-xs rounded-xl bg-rose-600 text-white">삭제</button>
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
        </section>
      </div>
    </main>
  );
}
