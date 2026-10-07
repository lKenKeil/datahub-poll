import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { getPollVoteActor, withVoteActorCookie } from "@/lib/poll-vote-identity";
import {
  accountVotingMigrationResponse,
  getPollViewerVote,
  getPollVoteManagement,
  isAccountVotingMigrationMissing,
  isVoteManagementTokenValid,
  PRIVATE_VOTE_HEADERS,
  staleVoteManagementResponse,
  withPrivateVoteHeaders,
} from "@/lib/poll-vote-server";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { isModerationMigrationMissing, moderationErrorResponse } from "@/lib/content-report-server";
import {
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

type VoteBody = {
  optionIndex?: unknown;
  managementToken?: unknown;
};

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

    let body: VoteBody;
    try {
      body = (await request.json()) as VoteBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const optionIndex = body?.optionIndex;
    if (!Number.isInteger(optionIndex)) {
      return NextResponse.json({ error: "optionIndex must be an integer." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id,title,category,options,votes,participants,is_hidden")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      if (isModerationMigrationMissing(pollError)) return withPrivateVoteHeaders(moderationErrorResponse(pollError, "vote-create-poll-read"));
      logPublicMutationError("vote-create-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "poll not found." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
    }

    const options = Array.isArray(poll.options) ? poll.options : [];
    const votes = Array.isArray(poll.votes) ? poll.votes : [];
    const participants = Number(poll.participants);

    if (
      typeof poll.title !== "string" ||
      !poll.title.trim() ||
      typeof poll.category !== "string" ||
      !poll.category.trim() ||
      options.length < 2 ||
      votes.length !== options.length ||
      !votes.every((value) => Number.isInteger(value) && value >= 0) ||
      !Number.isInteger(participants) ||
      participants < 0
    ) {
      return NextResponse.json({ error: "poll data is invalid." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
    }

    if ((optionIndex as number) < 0 || (optionIndex as number) >= options.length) {
      return NextResponse.json({ error: "optionIndex is out of range." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const rpcPayload = {
      p_poll_id: id,
      p_option_index: optionIndex as number,
      // Identity comes only from verified Auth and a server HMAC of the cookie.
      // Body user_id/guest_id_hash/voterId never selects a new vote actor.
      ...(actor.userId ? { p_user_id: actor.userId } : {}),
      p_guest_id_hash: actor.guestHash,
    };

    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc(
      actor.userId ? "cast_authenticated_poll_vote" : "cast_guest_poll_vote", rpcPayload,
    );

    if (rpcError) {
      if (isAccountVotingMigrationMissing(rpcError)) return accountVotingMigrationResponse();
      if (rpcError.message === "VOTE_REQUIRES_ACCOUNT") {
        return NextResponse.json({ error: "이미 참여한 질문입니다. 새로고침 후 선택을 변경해주세요." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "23505" || rpcError.message === "POLL_ALREADY_VOTED") {
        return NextResponse.json({ error: "이미 참여한 질문입니다. 새로고침 후 선택을 변경해주세요." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "P0002") {
        return NextResponse.json({ error: "poll not found." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "22023") {
        return NextResponse.json({ error: "선택지를 확인하고 다시 시도해주세요." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
      }
      if (isModerationMigrationMissing(rpcError)) return withPrivateVoteHeaders(moderationErrorResponse(rpcError, "vote-create-rpc"));
      logPublicMutationError("vote-create-rpc", rpcError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      logPublicMutationError("vote-create-empty-rpc-result", new Error("RPC returned no row."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    const viewerVote = await getPollViewerVote(supabaseMutation, id, actor);
    return finish(NextResponse.json({
      data: {
        id: row.id,
        votes: row.votes,
        participants: row.participants,
        viewerVote,
        ...viewerVote,
      },
      mode: "rpc",
    }, { headers: PRIVATE_VOTE_HEADERS }));
  } catch (error) {
    logPublicMutationError("vote-create-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}

export async function PATCH(request: Request, context: Context) {
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

    let body: VoteBody;
    try {
      body = (await request.json()) as VoteBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const optionIndex = body?.optionIndex;
    if (!Number.isInteger(optionIndex)) {
      return NextResponse.json({ error: "optionIndex must be an integer." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id,options,votes,participants,is_hidden")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      if (isModerationMigrationMissing(pollError)) return withPrivateVoteHeaders(moderationErrorResponse(pollError, "vote-change-poll-read"));
      logPublicMutationError("vote-change-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "poll not found." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
    }

    const options = Array.isArray(poll.options) ? poll.options : [];
    const votes = Array.isArray(poll.votes) ? poll.votes : [];
    const participants = Number(poll.participants);

    if (
      options.length < 2
      || votes.length !== options.length
      || !votes.every((value) => Number.isInteger(value) && value >= 0)
      || !Number.isInteger(participants)
      || participants < 0
    ) {
      return NextResponse.json({ error: "poll data is invalid." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
    }

    if ((optionIndex as number) < 0 || (optionIndex as number) >= options.length) {
      return NextResponse.json({ error: "optionIndex is out of range." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const managed = await getPollVoteManagement(supabaseMutation, id, actor);
    if (!managed || !isVoteManagementTokenValid(body.managementToken, managed.viewerVote.managementToken!)) {
      return staleVoteManagementResponse();
    }
    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("change_managed_poll_vote", {
      p_poll_id: id,
      p_new_option_index: optionIndex as number,
      p_user_id: actor.userId,
      p_guest_id_hash: actor.guestHash,
      p_expected_vote_id: managed.rowId,
    });

    if (rpcError) {
      if (isAccountVotingMigrationMissing(rpcError)) return accountVotingMigrationResponse();
      if (rpcError.message === "VOTE_MANAGEMENT_CONFLICT") return staleVoteManagementResponse();
      if (["INVALID_POLL_VOTE_DATA", "POLL_VOTE_COUNTER_INVALID"].includes(rpcError.message)) {
        return NextResponse.json({ error: "투표 상태를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "P0002") {
        if (rpcError.message === "CONTENT_NOT_AVAILABLE" || rpcError.message === "Poll not found." || rpcError.message === "POLL_NOT_FOUND") {
          return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
        }
        return NextResponse.json({ error: "기존 투표를 찾을 수 없습니다." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "22023") {
        return NextResponse.json({ error: "선택지를 확인하고 다시 시도해주세요." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
      }
      if (isModerationMigrationMissing(rpcError)) return withPrivateVoteHeaders(moderationErrorResponse(rpcError, "vote-change-rpc"));
      logPublicMutationError("vote-change-rpc", rpcError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      logPublicMutationError("vote-change-empty-rpc-result", new Error("RPC returned no row."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    const viewerVote = await getPollViewerVote(supabaseMutation, id, actor);
    return finish(NextResponse.json({
      data: {
        id: row.id,
        votes: row.votes,
        participants: row.participants,
        viewerVote,
        ...viewerVote,
        changed: row.changed,
      },
      mode: "rpc",
    }, { headers: PRIVATE_VOTE_HEADERS }));
  } catch (error) {
    logPublicMutationError("vote-change-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}

export async function DELETE(request: Request, context: Context) {
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

    let body: { managementToken?: unknown };
    try { body = await request.json(); }
    catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls").select("id,is_hidden").eq("id", id).maybeSingle();
    if (pollError) {
      if (isModerationMigrationMissing(pollError)) return withPrivateVoteHeaders(moderationErrorResponse(pollError, "vote-cancel-poll-read"));
      logPublicMutationError("vote-cancel-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }
    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404, headers: PRIVATE_VOTE_HEADERS });
    }

    const managed = await getPollVoteManagement(supabaseMutation, id, actor);
    if (!managed || !isVoteManagementTokenValid(body?.managementToken, managed.viewerVote.managementToken!)) {
      return staleVoteManagementResponse();
    }
    // Never accept actor proof from a request body, query, or custom header.
    // The RPC atomically selects account-first/browser-second and cancels
    // only that existing row; it does not transfer or merge vote identities.
    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("cancel_managed_poll_vote", {
      p_poll_id: id,
      p_user_id: actor.userId,
      p_guest_id_hash: actor.guestHash,
      p_expected_vote_id: managed.rowId,
    });
    if (rpcError) {
      if (isAccountVotingMigrationMissing(rpcError)) return accountVotingMigrationResponse();
      if (rpcError.message === "VOTE_MANAGEMENT_CONFLICT") return staleVoteManagementResponse();
      if (["INVALID_POLL_VOTE_DATA", "POLL_VOTE_COUNTER_INVALID"].includes(rpcError.message)) {
        return NextResponse.json({ error: "투표 상태를 확인할 수 없습니다. 새로고침 후 다시 시도해주세요." }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "P0002") {
        const unavailable = ["CONTENT_NOT_AVAILABLE", "Poll not found.", "POLL_NOT_FOUND"].includes(rpcError.message);
        return NextResponse.json({ error: unavailable ? "질문을 찾을 수 없습니다." : "기존 투표를 찾을 수 없습니다." }, { status: unavailable ? 404 : 409, headers: PRIVATE_VOTE_HEADERS });
      }
      if (rpcError.code === "22023") {
        return NextResponse.json({ error: "투표 정보를 확인하고 다시 시도해주세요." }, { status: 400, headers: PRIVATE_VOTE_HEADERS });
      }
      if (isModerationMigrationMissing(rpcError)) return withPrivateVoteHeaders(moderationErrorResponse(rpcError, "vote-cancel-rpc"));
      logPublicMutationError("vote-cancel-rpc", rpcError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      logPublicMutationError("vote-cancel-empty-rpc-result", new Error("RPC returned no row."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
    }
    const viewerVote = await getPollViewerVote(supabaseMutation, id, actor);
    return finish(NextResponse.json({
      data: { id: row.id, votes: row.votes, participants: row.participants, viewerVote },
      mode: "rpc",
    }, { headers: PRIVATE_VOTE_HEADERS }));
  } catch (error) {
    logPublicMutationError("vote-cancel-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}
