import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { isLoginProvider, type AuthFlowMode, type LoginProvider } from '@/lib/auth-flow';

export const AUTH_RETURN_COOKIE = 'askio_auth_return_to';
const AUTH_SUCCESS_COOKIE = 'askio_auth_success';
const MAX_AGE_SECONDS = 600;
type AuthIntent = {
  mode: AuthFlowMode; provider: LoginProvider; returnTo: string;
  userId: string | null; expiresAt: number;
};
type LoginReceipt = { provider: LoginProvider; userId: string; expiresAt: number };

function secret() {
  const value = process.env.GUEST_ID_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error('Authentication flow is not configured.');
  return value;
}
function sign(value: string, purpose: string) {
  return createHmac('sha256', secret()).update(`askio-auth-${purpose}-v1:${value}`).digest('base64url');
}
function encode(value: AuthIntent | LoginReceipt, purpose: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(payload, purpose)}`;
}
function decode(value: string, purpose: string): Record<string, unknown> | null {
  try {
    if (value.length > 4000) return null;
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra || !/^[\w-]+$/.test(signature)) return null;
    const expected = Buffer.from(sign(payload, purpose));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result = parsed as Record<string, unknown>;
    if (typeof result.expiresAt !== 'number' || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + MAX_AGE_SECONDS * 1000) return null;
    return result;
  } catch { return null; }
}
const options = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: MAX_AGE_SECONDS });

export async function writeAuthIntent(value: Omit<AuthIntent, 'expiresAt'>) {
  const store = await cookies();
  store.set(AUTH_RETURN_COOKIE, encode({ ...value, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 }, 'intent'), options());
  // A failed new flow must never reuse a previous successful-login receipt.
  store.set(AUTH_SUCCESS_COOKIE, '', { ...options(), maxAge: 0 });
}
export async function readAuthIntent(): Promise<{ present: boolean; intent: AuthIntent | null }> {
  const value = (await cookies()).get(AUTH_RETURN_COOKIE)?.value;
  if (!value) return { present: false, intent: null };
  const data = decode(value, 'intent');
  if (!data || (data.mode !== 'login' && data.mode !== 'link') || !isLoginProvider(data.provider)
    || typeof data.returnTo !== 'string' || getSafeAuthReturnPath(data.returnTo) !== data.returnTo
    || (data.mode === 'link' && (data.provider === 'email' || typeof data.userId !== 'string'))
    || (data.mode === 'login' && data.userId !== null)) return { present: true, intent: null };
  return { present: true, intent: data as AuthIntent };
}
export async function clearAuthIntent() {
  (await cookies()).set(AUTH_RETURN_COOKIE, '', { ...options(), maxAge: 0 });
}
export async function writeLoginReceipt(provider: LoginProvider, userId: string) {
  (await cookies()).set(AUTH_SUCCESS_COOKIE, encode({ provider, userId, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 }, 'success'), options());
}
export async function consumeLoginReceipt(userId: string): Promise<LoginProvider | null> {
  const store = await cookies();
  const value = store.get(AUTH_SUCCESS_COOKIE)?.value;
  store.set(AUTH_SUCCESS_COOKIE, '', { ...options(), maxAge: 0 });
  const data = value ? decode(value, 'success') : null;
  return data?.userId === userId && isLoginProvider(data.provider) ? data.provider : null;
}
