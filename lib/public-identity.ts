import { getSafeAvatarUrl } from '@/lib/profile';

// Explicit allowlists also protect service-role RPC results after schema grows.
const PUBLIC_POLL_FIELDS = [
  'id', 'title', 'category', 'options', 'votes', 'participants', 'is_hidden',
  'official_fact', 'option_image_paths', 'created_at', 'edit_lock_mode',
  'edit_lock_minutes', 'edit_lock_participants', 'is_anonymous',
] as const;
export const PUBLIC_POLL_COLUMNS = 'id,title,category,options,votes,participants,is_hidden,official_fact,option_image_paths,created_at,edit_lock_mode,edit_lock_minutes,edit_lock_participants,is_anonymous';
export const PUBLIC_COMMENT_COLUMNS = 'id,poll_id,parent_id,text,user_name,created_at,is_hidden,is_anonymous';

export function serializePublicPoll(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(PUBLIC_POLL_FIELDS.filter((field) => Object.hasOwn(row, field))
    .map((field) => [field, row[field]]));
}

export type PublicProfileIdentity = { nickname: string; avatar_url: unknown };

export function serializePublicComment(
  row: Record<string, unknown>,
  profile: PublicProfileIdentity | null = null,
  hasAccount = false,
) {
  const anonymous = row.is_anonymous === true;
  const displayName = anonymous ? '익명' : profile?.nickname
    ?? (hasAccount ? '익명 유저' : typeof row.user_name === 'string' ? row.user_name : '익명 유저');
  return {
    id: row.id,
    poll_id: row.poll_id,
    parent_id: row.parent_id ?? null,
    text: row.text,
    created_at: row.created_at,
    is_hidden: row.is_hidden === true,
    is_anonymous: anonymous,
    user_name: displayName,
    displayName,
    ...(!anonymous && profile ? {
      nickname: profile.nickname,
      avatar_url: getSafeAvatarUrl(profile.avatar_url),
    } : {}),
  };
}
