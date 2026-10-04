import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  // Anonymous reading/voting does not need an Auth network request.
  if (!request.cookies.getAll().some(({ name }) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name))) return response;

  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');
      },
    },
  });
  // Refresh only; every protected Route Handler also verifies the user.
  try { await client.auth.getClaims(); } catch { /* Keep public pages available. */ }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)'],
};
