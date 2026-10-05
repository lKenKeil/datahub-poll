import 'server-only';
import { requireAuthenticatedUser } from '@/lib/auth-server';
import { getGuestCommentIdentity, hasAuthCredentials } from '@/lib/comment-identity';

export async function getCommentReactionActor(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (auth.user) return { key: `account:${auth.user.id}`, newCookie: null, response: null };
  if (auth.response?.status !== 401 || hasAuthCredentials(request)) return { key: null, newCookie: null, response: auth.response };
  const guest = getGuestCommentIdentity(request);
  return { key: `guest:${guest.hash}`, newCookie: guest.newCookie, response: null };
}
