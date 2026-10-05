import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';

const COOKIE_NAME = 'askio_guest_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANIMALS = ['수달', '펭귄', '여우', '토끼', '고양이', '강아지', '라쿤', '판다', '햄스터', '참새', '고래', '사슴', '코알라', '오리', '다람쥐', '기린', '물개', '두루미', '돌고래', '곰'];

export class CommentIdentityUnavailable extends Error {}

function digest(domain: string, ...parts: string[]) {
  const secret = process.env.GUEST_ID_SECRET;
  if (!secret || secret.length < 32) throw new CommentIdentityUnavailable('Comment identity is not configured.');
  return createHmac('sha256', secret).update(JSON.stringify([domain, ...parts])).digest();
}

export function anonymousCommentAlias(pollId: string, actorType: 'guest' | 'account', identity: string) {
  const bytes = digest('askio-comment-alias-v1', pollId, actorType, identity);
  return `익명 ${ANIMALS[bytes.readUInt32BE(0) % ANIMALS.length]} ${String(bytes.readUInt32BE(4) % 100).padStart(2, '0')}`;
}

export function getGuestCommentIdentity(request: Request) {
  // Only headers are needed; the POST body has already been consumed.
  const cookie = new NextRequest(request.url, { headers: request.headers }).cookies.get(COOKIE_NAME)?.value;
  const rawId = cookie && UUID.test(cookie) ? cookie.toLowerCase() : randomUUID();
  return { hash: digest('askio-guest-comment-id-v1', rawId).toString('hex'), newCookie: rawId !== cookie ? rawId : null };
}

export function setGuestCommentCookie(response: NextResponse, rawId: string | null, request: Request) {
  if (!rawId) return;
  const url = new URL(request.url);
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  response.cookies.set(COOKIE_NAME, rawId, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60,
    secure: url.protocol === 'https:' || (process.env.NODE_ENV === 'production' && !localhost),
  });
}

export function hasAuthCredentials(request: Request) {
  return Boolean(request.headers.get('authorization'))
    || /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(request.headers.get('cookie') ?? '');
}

export function hasMultipleGuestUrls(text: string) {
  return (text.match(/(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|kr|io|co|me)\b[^\s<>]*/gi)?.length ?? 0) > 1;
}
