export const COMMENT_SORTS = { likes: '좋아요순', dislikes: '싫어요순', replies: '답글 많은 순', latest: '최신순' } as const;
export type CommentSort = keyof typeof COMMENT_SORTS;
export function parseCommentSort(value: string | null): CommentSort {
  return value && Object.hasOwn(COMMENT_SORTS, value) ? value as CommentSort : 'likes';
}

// Sort roots only. Keep every reply's position within its original thread.
export function sortComments<T extends { id: unknown; parent_id?: unknown; created_at?: unknown; like_count?: unknown; dislike_count?: unknown; is_hidden?: unknown }>(comments: T[], mode: CommentSort): T[] {
  const replies = new Map<string, number>();
  for (const row of comments) if (row.parent_id && !row.is_hidden) {
    const id = String(row.parent_id);
    replies.set(id, (replies.get(id) ?? 0) + 1);
  }
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  const time = (row: T) => Date.parse(String(row.created_at)) || 0;
  const roots = comments.filter(row => !row.parent_id).sort((a, b) => {
    const likes = count(b.like_count) - count(a.like_count);
    const dislikes = count(b.dislike_count) - count(a.dislike_count);
    const primary = mode === 'likes' ? likes || -dislikes
      : mode === 'dislikes' ? dislikes || -likes
      : mode === 'replies' ? (replies.get(String(b.id)) ?? 0) - (replies.get(String(a.id)) ?? 0) || likes : 0;
    return primary || time(b) - time(a) || String(a.id).localeCompare(String(b.id), 'en');
  });
  let index = 0;
  return comments.map(row => row.parent_id ? row : roots[index++]);
}
