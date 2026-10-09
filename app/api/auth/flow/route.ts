import { NextResponse } from 'next/server';
import { createSupabaseAuthServerClient } from '@/lib/supabase-auth-server';
import { clearAuthIntent, consumeLoginReceipt, readAuthIntent, writeAuthIntent } from '@/lib/auth-flow-server';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { isLoginProvider } from '@/lib/auth-flow';

const headers = { 'Cache-Control': 'private, no-store' };
const failure = (status: number) => NextResponse.json({ ok: false }, { status, headers });

export async function POST(request: Request) {
  // Cookie-based intents must originate in this browser on this exact origin.
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('sec-fetch-site') === 'cross-site') return failure(403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure(400);
  try {
    const raw = await request.text();
    if (raw.length > 3000) return failure(400);
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return failure(400);
    const body = input as Record<string, unknown>;
    if (body.action === 'cancel') {
      await clearAuthIntent();
      return NextResponse.json({ ok: true }, { headers });
    }
    if (body.action === 'start') {
      if (!isLoginProvider(body.provider) || (body.mode !== 'login' && body.mode !== 'link')
        || (body.mode === 'link' && body.provider === 'email')) return failure(400);
      let userId: string | null = null;
      if (body.mode === 'link') {
        const client = await createSupabaseAuthServerClient();
        const { data, error } = await client.auth.getUser();
        if (error || !data.user || data.user.is_anonymous) return failure(401);
        userId = data.user.id;
      }
      await writeAuthIntent({ mode: body.mode, provider: body.provider, returnTo: getSafeAuthReturnPath(body.returnTo), userId });
      return NextResponse.json({ ok: true }, { headers });
    }
    if (body.action !== 'complete-email' && body.action !== 'recent-provider') return failure(400);
    const client = await createSupabaseAuthServerClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.is_anonymous) return failure(401);
    if (body.action === 'recent-provider') {
      const provider = await consumeLoginReceipt(data.user.id);
      return NextResponse.json({ ok: true, provider }, { headers });
    }
    const { intent } = await readAuthIntent();
    if (!intent || intent.mode !== 'login' || intent.provider !== 'email') return failure(400);
    await clearAuthIntent();
    return NextResponse.json({ ok: true, returnTo: intent.returnTo }, { headers });
  } catch { return failure(503); }
}
