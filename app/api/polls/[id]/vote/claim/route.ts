import { NextResponse } from "next/server";
import { getPollVoteActor, withVoteActorCookie } from "@/lib/poll-vote-identity";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { isValidVoterId } from "@/lib/voter-id";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { isModerationMigrationMissing, moderationErrorResponse } from "@/lib/content-report-server";
import {
  accountVotingMigrationResponse,
  getPollViewerVote,
  getPollVoteIdentityStatus,
  isAccountVotingMigrationMissing,
  PRIVATE_VOTE_HEADERS,
  withPrivateVoteHeaders,
} from "@/lib/poll-vote-server";
import {
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.voteMutation);
  if (rateLimitResponse) return withPrivateVoteHeaders(rateLimitResponse);
  const identity = await getPollVoteActor(request);
  if (!identity.actor) return identity.response;
  const actor = identity.actor;
  const finish = (response: NextResponse) => withVoteActorCookie(response, actor, request);

  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }
    let body: { voterId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }
    const voterId = typeof body?.voterId === "string" ? body.voterId.trim().toLowerCase() : "";
    if (body?.voterId !== undefined && body.voterId !== null && body.voterId !== "" && !isValidVoterId(voterId)) {
      return NextResponse.json({ error: "voterId must be a valid UUID." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls").select("id,votes,participants,is_hidden").eq("id", id).maybeSingle();
    if (pollError) {
      if (isModerationMigrationMissing(pollError)) return withPrivateVoteHeaders(moderationErrorResponse(pollError, "vote-claim-poll-read"));
      throw pollError;
    }
    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
    }

    // Claim never changes aggregates. Account wins conflicts; guest claims
    // only an unowned legacy row and cannot take a different account's vote.
    const { data, error } = await supabaseMutation.rpc(actor.userId ? "claim_authenticated_poll_vote" : "claim_guest_poll_vote", {
      p_poll_id: id,
      p_legacy_voter_id: voterId || null,
      ...(actor.userId ? { p_user_id: actor.userId } : {}),
      p_guest_id_hash: actor.guestHash,
    });
    // Older deployed claim RPCs rejected an already-account-bound browser
    // row. That is a normal participation result, never another guest actor.
    const browserConflict = error?.code === "42501" && error.message === "VOTE_REQUIRES_ACCOUNT";
    if (error && !browserConflict) {
      if (isAccountVotingMigrationMissing(error)) return accountVotingMigrationResponse();
      if (error.code === "P0002") {
        return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: "이전 투표 정보를 확인해주세요." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
      }
      if (isModerationMigrationMissing(error)) return withPrivateVoteHeaders(moderationErrorResponse(error, "vote-claim-rpc"));
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const viewerVote = await getPollViewerVote(supabaseMutation, id, actor);
    return finish(NextResponse.json({
      data: viewerVote ? {
        id,
        votes: row?.votes ?? poll.votes,
        participants: row?.participants ?? poll.participants,
        ...viewerVote,
      } : null,
      mode: "rpc",
      viewerIdentityStatus: getPollVoteIdentityStatus(actor),
    }, { headers: PRIVATE_VOTE_HEADERS }));
  } catch (error) {
    logPublicMutationError("vote-claim-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}
