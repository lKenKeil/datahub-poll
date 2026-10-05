import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { requireAuthenticatedUser } from "@/lib/auth-server";
import {
  accountVotingMigrationResponse,
  isAccountVotingMigrationMissing,
  PRIVATE_VOTE_HEADERS,
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
};

export async function POST(request: Request, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.user) return auth.response;
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.voteMutation);
  if (rateLimitResponse) return withPrivateVoteHeaders(rateLimitResponse);

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
      // Only the verified Auth user reaches this service-only RPC. Request
      // bodies and x-voter-id are never a new vote identity.
      p_user_id: auth.user.id,
    };

    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("cast_authenticated_poll_vote", rpcPayload);

    if (rpcError) {
      if (isAccountVotingMigrationMissing(rpcError)) return accountVotingMigrationResponse();
      if (rpcError.code === "23505") {
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

    return NextResponse.json({
      data: {
        id: row.id,
        votes: row.votes,
        participants: row.participants,
        optionIndex: row.option_index,
      },
      mode: "rpc",
    }, { headers: PRIVATE_VOTE_HEADERS });
  } catch (error) {
    logPublicMutationError("vote-create-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.user) return auth.response;
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.voteMutation);
  if (rateLimitResponse) return withPrivateVoteHeaders(rateLimitResponse);

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

    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("change_authenticated_poll_vote", {
      p_poll_id: id,
      p_new_option_index: optionIndex as number,
      p_user_id: auth.user.id,
    });

    if (rpcError) {
      if (isAccountVotingMigrationMissing(rpcError)) return accountVotingMigrationResponse();
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

    return NextResponse.json({
      data: {
        id: row.id,
        votes: row.votes,
        participants: row.participants,
        optionIndex: row.option_index,
        changed: row.changed,
      },
      mode: "rpc",
    }, { headers: PRIVATE_VOTE_HEADERS });
  } catch (error) {
    logPublicMutationError("vote-change-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: PRIVATE_VOTE_HEADERS });
  }
}
