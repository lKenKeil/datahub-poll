import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth-server';
import { getSupabaseMutationClient } from '@/lib/supabase-server';
import { accountErrorResponse } from '@/lib/profile-server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    if (new URL(request.url).search) return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 400, headers });
    const client = getSupabaseMutationClient();
    const [{ data: polls, error: pollError }, { data: comments, error: commentError }] = await Promise.all([
      client.from('polls').select('id,title,category,created_at,is_anonymous')
        .eq('author_user_id', auth.user.id).eq('is_hidden', false)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(100),
      client.from('comments').select('id,poll_id,text,created_at,is_anonymous,parent_id')
        .eq('user_id', auth.user.id).eq('is_hidden', false)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(100),
    ]);
    if (pollError) throw pollError;
    if (commentError) throw commentError;
    const pollIds = [...new Set([...(polls ?? []).map((poll) => String(poll.id)), ...(comments ?? []).map((comment) => String(comment.poll_id))])];
    // Recheck both content types at the last asynchronous boundary. No hidden
    // originals or account identifiers are projected into the response.
    const [pollStates, commentStates] = await Promise.all([
      pollIds.length ? client.from('polls').select('id,title').in('id', pollIds).eq('is_hidden', false)
        : Promise.resolve({ data: [], error: null }),
      comments?.length ? client.from('comments').select('id').eq('user_id', auth.user.id)
        .eq('is_hidden', false).in('id', comments.map((comment) => comment.id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (pollStates.error) throw pollStates.error;
    if (commentStates.error) throw commentStates.error;
    const visible = new Map<string, string>((pollStates.data ?? []).map((row) => [String(row.id), String(row.title)]));
    const visibleCommentIds = new Set((commentStates.data ?? []).map((row) => String(row.id)));
    return NextResponse.json({
      polls: (polls ?? []).filter((row) => visible.has(String(row.id))).map((row) => ({
        id: row.id, title: row.title, category: row.category, created_at: row.created_at, is_anonymous: row.is_anonymous === true,
      })),
      comments: (comments ?? []).filter((row) => visible.has(String(row.poll_id)) && visibleCommentIds.has(String(row.id))).map((row) => ({
        id: row.id, poll_id: row.poll_id, text: String(row.text).slice(0, 200),
        poll_title: visible.get(String(row.poll_id)), created_at: row.created_at,
        is_anonymous: row.is_anonymous === true, is_reply: Boolean(row.parent_id),
      })),
    }, { headers });
  } catch (error) { return accountErrorResponse(error, 'my-activity-read'); }
}
