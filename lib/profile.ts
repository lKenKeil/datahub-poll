import { validateNickname } from '@/lib/nickname';

// The browser receives only the account fields it needs, never Auth metadata.
export type AccountProfile = {
  nickname: string;
  avatar_url: string | null;
  onboarding_completed: boolean;
  show_avatar: boolean;
  avatar_source?: 'default' | 'social' | 'uploaded';
  social_avatar_url?: string | null;
  uploaded_avatar_url?: string | null;
};

export function getSafeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseAccountProfile(value: unknown): AccountProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const nickname = validateNickname(raw.nickname);
  if (!nickname.ok || typeof raw.onboarding_completed !== 'boolean') return null;
  return {
    nickname: nickname.value,
    avatar_url: getSafeAvatarUrl(raw.avatar_url),
    onboarding_completed: raw.onboarding_completed,
    show_avatar: raw.show_avatar === true,
    avatar_source: raw.avatar_source === 'default' || raw.avatar_source === 'uploaded' ? raw.avatar_source : 'social',
    social_avatar_url: getSafeAvatarUrl(raw.social_avatar_url) ?? (raw.avatar_source !== 'uploaded' && raw.avatar_source !== 'default' ? getSafeAvatarUrl(raw.avatar_url) : null),
    uploaded_avatar_url: getSafeAvatarUrl(raw.uploaded_avatar_url),
  };
}
