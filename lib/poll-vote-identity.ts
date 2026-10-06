import "server-only";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import {
  CommentIdentityUnavailable,
  getGuestCommentIdentity,
  hasAuthCredentials,
  setGuestCommentCookie,
} from "@/lib/comment-identity";
import { PRIVATE_VOTE_HEADERS, withPrivateVoteHeaders } from "@/lib/poll-vote-server";

export type PollVoteActor = {
  userId: string | null;
  guestHash: string | null;
  reactionKey: string | null;
  newCookie: string | null;
  viewerVerified: boolean;
};

export function getGuestVoteIdentity(request: Request) {
  const commentIdentity = getGuestCommentIdentity(request);
  const rawId = commentIdentity.newCookie
    ?? new NextRequest(request.url, { headers: request.headers }).cookies.get("askio_guest_id")!.value.toLowerCase();
  // Reuse the browser cookie, not the comment hash. Domain separation prevents
  // linking vote and comment guest identifiers through equal database values.
  const hash = createHmac("sha256", process.env.GUEST_ID_SECRET!)
    .update(JSON.stringify(["askio-guest-vote-id-v1", rawId])).digest("hex");
  return { hash, commentHash: commentIdentity.hash, newCookie: commentIdentity.newCookie };
}

function authError(status: 401 | 403 | 503) {
  return NextResponse.json({
    code: status === 401 ? "AUTH_VERIFICATION_REQUIRED" : status === 503 ? "VOTE_IDENTITY_UNAVAILABLE" : "FORBIDDEN",
    error: status === 401 ? "로그인 상태를 확인한 후 다시 시도해주세요."
      : status === 503 ? "투표 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." : "허용되지 않은 요청입니다.",
  }, { status, headers: PRIVATE_VOTE_HEADERS });
}

export async function getPollVoteActor(request: Request, requireGuestIdentity = true) {
  const unavailable = (status: 401 | 403 | 503) => requireGuestIdentity
    ? { actor: null, response: authError(status) }
    : { actor: { userId: null, guestHash: null, reactionKey: null, newCookie: null, viewerVerified: false } satisfies PollVoteActor, response: null };
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return unavailable(403);
  }
  let userId: string | null = null;
  try {
    const client = await createSupabaseAuthServerClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error) {
      // An actually missing session is guest access. A broken/expired supplied
      // session or an Auth outage must never silently become another guest vote.
      const sessionMissing = error.name === "AuthSessionMissingError";
      if (!sessionMissing || hasAuthCredentials(request)) {
        const status = typeof error.status === "number" && error.status >= 500 ? 503
          : error.name === "AuthRetryableFetchError" || !error.status ? 503 : 401;
        return unavailable(status);
      }
    } else if (user && !user.is_anonymous) {
      userId = user.id;
    } else if (hasAuthCredentials(request)) {
      return unavailable(401);
    }
  } catch {
    return unavailable(503);
  }

  let guest: ReturnType<typeof getGuestVoteIdentity> | null = null;
  try { guest = getGuestVoteIdentity(request); }
  catch (error) {
    if (!(error instanceof CommentIdentityUnavailable)) return unavailable(503);
    // Reading questions remains possible without guest configuration. Account
    // voting also keeps working; only guest mutations require the HMAC secret.
    if (!userId && requireGuestIdentity) return unavailable(503);
  }
  return { actor: {
    userId, guestHash: guest?.hash ?? null, newCookie: guest?.newCookie ?? null, viewerVerified: true,
    reactionKey: userId ? `account:${userId}` : guest ? `guest:${guest.commentHash}` : null,
  } satisfies PollVoteActor, response: null };
}

export function withVoteActorCookie<T extends Response>(response: T, actor: PollVoteActor, request: Request): T {
  if (actor.newCookie && "cookies" in response) setGuestCommentCookie(response as unknown as NextResponse, actor.newCookie, request);
  return withPrivateVoteHeaders(response);
}
