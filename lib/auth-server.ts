import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseAuthServerClient } from '@/lib/supabase-auth-server';

export async function requireAuthenticatedUser(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return { user: null, response: NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403, headers }) };
  }
  try {
    const client = await createSupabaseAuthServerClient();
    // Fresh server verification, not untrusted cookie/session data.
    const { data: { user }, error } = await client.auth.getUser();
    if (!error && user && !user.is_anonymous) return { user, response: null };
  } catch {
    // No cookie contents, OAuth details or raw Auth errors in responses/logs.
  }
  return { user: null, response: NextResponse.json({ error: '로그인이 필요해요.', code: 'AUTH_REQUIRED' }, { status: 401, headers }) };
}
