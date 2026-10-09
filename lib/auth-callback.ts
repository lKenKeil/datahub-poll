import { NextResponse } from 'next/server';
import { createSupabaseAuthServerClient } from '@/lib/supabase-auth-server';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { clearAuthIntent, readAuthIntent, writeLoginReceipt } from '@/lib/auth-flow-server';
import type { AuthFlowMode } from '@/lib/auth-flow';

export async function handleAuthCallback(request: Request, mode: AuthFlowMode) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await readAuthIntent();
  // Keep old in-flight sign-in URLs compatible, but never downgrade a broken
  // or missing linking intent to sign-in. Linking has its own fixed callback.
  const intent = state.intent;
  const valid = mode === 'link'
    ? intent?.mode === 'link'
    : !state.present || (intent?.mode === 'login' && intent.provider !== 'email');
  const next = intent?.returnTo ?? getSafeAuthReturnPath(url.searchParams.get('next'));
  const failure = new URL(mode === 'link' ? next === '/' ? '/profile' : next : '/auth/login', url.origin);
  let conflict = url.searchParams.get('error_code') === 'identity_already_exists';
  if (valid && code && !url.searchParams.has('error') && !url.searchParams.has('error_code')) {
    try {
      const client = await createSupabaseAuthServerClient();
      if (mode === 'link') {
        const before = await client.auth.getUser();
        if (before.error || !before.data.user || before.data.user.is_anonymous || before.data.user.id !== intent?.userId) throw new Error('Linking session changed.');
      }
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (mode === 'link' && error?.code === 'identity_already_exists') conflict = true;
      if (!error) {
        const current = await client.auth.getUser();
        if (current.error || !current.data.user || current.data.user.is_anonymous) throw new Error('Session verification failed.');
        if (mode === 'link' && current.data.user.id !== intent?.userId) {
          // Never leave a different canonical account authenticated as a link.
          await client.auth.signOut({ scope: 'local' });
          throw new Error('Linking account changed.');
        }
        if (mode === 'link' && !current.data.user.identities?.some((identity) => identity.provider === intent?.provider && identity.user_id === current.data.user?.id)) {
          throw new Error('Linked identity verification failed.');
        }
        await clearAuthIntent();
        const destination = new URL(next, url.origin);
        if (mode === 'link') destination.searchParams.set('auth_link', 'success');
        else if (intent) await writeLoginReceipt(intent.provider, current.data.user.id);
        return NextResponse.redirect(destination, { headers: { 'Cache-Control': 'private, no-store' } });
      }
    } catch { /* Never expose provider errors or authorization codes. */ }
  }
  await clearAuthIntent();
  if (mode === 'link') failure.searchParams.set('auth_link', conflict && valid ? 'identity_already_exists' : 'failed');
  else {
    failure.searchParams.set('next', next);
    failure.searchParams.set('error', 'login_failed');
  }
  // An explicit empty fragment prevents browsers inheriting a provider's
  // error fragment across the HTTP redirect (fragments never reach the server).
  failure.hash = '#';
  return NextResponse.redirect(failure, { headers: { 'Cache-Control': 'private, no-store' } });
}
