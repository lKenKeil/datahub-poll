'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { AuthButton } from '@/components/auth-button';
import { AuthPrompt } from '@/components/auth-prompt';
import { BrandHomeLink } from '@/components/brand-home-link';
import { ThemeToggle } from '@/components/theme-toggle';

type Activity = {
  polls: { id: string; title: string; category: string; created_at: string; is_anonymous: boolean }[];
  comments: { id: string; poll_id: string; poll_title: string; text: string; created_at: string; is_anonymous: boolean; is_reply: boolean }[];
};

export function MyActivity() {
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState<{ userId: string; data: Activity | null; error: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const current = state?.userId === userId ? state : null;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void fetch('/api/me', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Activity unavailable.');
      const data: Activity = await response.json();
      if (!Array.isArray(data.polls) || !Array.isArray(data.comments)) throw new Error('Invalid activity.');
      if (!controller.signal.aborted) setState({ userId, data, error: false });
    }).catch(() => { if (!controller.signal.aborted) setState({ userId, data: null, error: true }); });
    return () => controller.abort();
  }, [userId, retry]);
  const date = (value: string) => new Date(value).toLocaleDateString('ko-KR');
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-line bg-surface"><div className="mx-auto flex min-h-[65px] w-full max-w-2xl items-center justify-between gap-3 px-4"><BrandHomeLink /><div className="flex shrink-0 items-center gap-2"><AuthButton /><ThemeToggle /></div></div></header>
    <main className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 py-8">
      <div><h1 className="text-2xl font-bold">마이페이지</h1><p className="mt-2 text-sm text-muted">내 질문과 의견을 다시 둘러보세요.</p><Link href="/profile" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-link">프로필 설정 →</Link></div>
      {loading ? <p role="status">불러오는 중...</p> : !user ? <AuthPrompt message="내 활동을 보려면 로그인해주세요." returnTo="/me" />
        : !current ? <p role="status">내 활동을 불러오는 중...</p>
        : current.error ? <div role="status"><p className="text-sm text-muted">내 활동을 불러오지 못했어요.</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 min-h-11 rounded-xl border border-line px-4 text-sm">다시 불러오기</button></div>
        : current.data ? <>
          <p className="text-xs text-muted">각 목록은 최근 100개까지 표시해요. 숨겨지거나 삭제된 콘텐츠는 제외돼요.</p>
          <section><h2 className="mb-3 text-lg font-bold">내가 올린 질문</h2><div className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
            {current.data.polls.length ? current.data.polls.map((poll) => <Link key={poll.id} href={`/vote/${encodeURIComponent(poll.id)}`} className="block min-h-11 py-4"><p className="break-words text-sm font-bold">{poll.title}</p><p className="mt-1 text-xs text-muted">{poll.category} · {date(poll.created_at)}{poll.is_anonymous ? ' · 익명으로 작성' : ''}</p></Link>) : <p className="py-5 text-sm text-muted">아직 올린 질문이 없어요.</p>}
          </div></section>
          <section><h2 className="mb-3 text-lg font-bold">내가 쓴 댓글</h2><div className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
            {current.data.comments.length ? current.data.comments.map((comment) => <Link key={comment.id} href={`/vote/${encodeURIComponent(comment.poll_id)}#comment-${encodeURIComponent(comment.id)}`} className="block min-h-11 py-4"><p className="break-words text-sm font-medium">{comment.text}</p><p className="mt-2 break-words text-xs text-muted">{comment.poll_title}</p><p className="mt-1 text-xs text-muted">{comment.is_reply ? '답글 · ' : ''}{date(comment.created_at)}{comment.is_anonymous ? ' · 익명으로 작성' : ''}</p></Link>) : <p className="py-5 text-sm text-muted">아직 남긴 의견이 없어요.</p>}
          </div></section>
        </> : null}
    </main>
  </div>;
}
