import { validateNickname } from '@/lib/nickname';

// The browser receives only the account fields it needs, never Auth metadata.
export type AccountProfile = {
  nickname: string;
  avatar_url: string | null;
  onboarding_completed: boolean;
  show_avatar: boolean;
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
  };
}
