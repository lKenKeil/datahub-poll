import type { User } from '@supabase/supabase-js';

// Display only. User-editable metadata must never grant permissions.
export function getAuthDisplayName(user: Pick<User, 'user_metadata' | 'email'>) {
  const metadata = user.user_metadata ?? {};
  const candidates = [metadata.display_name, metadata.full_name, metadata.name, metadata.nickname, user.email?.split('@')[0]];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
    if (name) return Array.from(name).slice(0, 40).join('');
  }
  return 'Askio 사용자';
}
