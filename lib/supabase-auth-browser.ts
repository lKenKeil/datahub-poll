'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let authClient: SupabaseClient | null = null;

export function getSupabaseAuthBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Authentication is not configured.');
  // PKCE codes are handled exclusively by the server callback. Do not parse
  // provider error fragments or OAuth credentials on arbitrary app pages.
  authClient ??= createBrowserClient(url, key, { auth: { detectSessionInUrl: false } });
  return authClient;
}
