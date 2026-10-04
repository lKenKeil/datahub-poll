import { NextResponse } from 'next/server';
import { createSupabaseAuthServerClient } from '@/lib/supabase-auth-server';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = getSafeAuthReturnPath(url.searchParams.get('next'));
  if (code && !url.searchParams.has('error')) {
    try {
      const client = await createSupabaseAuthServerClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch { /* Never expose provider errors or authorization codes. */ }
  }
  const failure = new URL('/auth/login', url.origin);
  failure.searchParams.set('next', next);
  failure.searchParams.set('error', 'login_failed');
  // An explicit empty fragment prevents browsers inheriting a provider's
  // error fragment across the HTTP redirect (fragments never reach the server).
  failure.hash = '#';
  return NextResponse.redirect(failure, { headers: { 'Cache-Control': 'private, no-store' } });
}
