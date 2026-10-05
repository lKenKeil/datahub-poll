import type { SupabaseClient } from '@supabase/supabase-js';

export function normalizeLoginEmail(value: string) {
  if (/[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@\u0000-\u001f\u007f]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Keep raw Auth errors, email addresses and OTP/session credentials out of logs
// and UI responses. Account existence is never used to change the message.
export async function sendEmailLoginCode(client: SupabaseClient, email: string): Promise<boolean> {
  try {
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    return !error;
  } catch { return false; }
}

export async function verifyEmailLoginCode(client: SupabaseClient, email: string, token: string): Promise<boolean> {
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
    return !error && Boolean(data.session);
  } catch { return false; }
}
