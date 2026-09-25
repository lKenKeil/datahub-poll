import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { isValidVoterId } from "@/lib/voter-id";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

type VoteBody = {
  optionIndex?: unknown;
  voterId?: unknown;
};

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.voteMutation);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400 });
    }

    let body: VoteBody;
    try {
      body = (await request.json()) as VoteBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    const optionIndex = body?.optionIndex;
    if (!Number.isInteger(optionIndex)) {
      return NextResponse.json({ error: "optionIndex must be an integer." }, { status: 400 });
    }

    const voterId = typeof body?.voterId === "string" ? body.voterId.trim().toLowerCase() : "";
    if (!isValidVoterId(voterId)) {
      return NextResponse.json({ error: "voterId must be a valid UUID." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id,title,category,options,votes,participants")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      logPublicMutationError("vote-create-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    if (!poll) {
      return NextResponse.json({ error: "poll not found." }, { status: 404 });
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
      return NextResponse.json({ error: "poll data is invalid." }, { status: 409 });
    }

    if ((optionIndex as number) < 0 || (optionIndex as number) >= options.length) {
      return NextResponse.json({ error: "optionIndex is out of range." }, { status: 400 });
    }

    const rpcPayload = {
      p_poll_id: id,
      p_option_index: optionIndex as number,
      p_voter_id: voterId,
    };

    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("increment_poll_vote", rpcPayload);

    if (rpcError) {
      if (rpcError.code === "23505") {
        return NextResponse.json({ error: "Already voted on this poll." }, { status: 409 });
      }
      if (rpcError.code === "P0002") {
        return NextResponse.json({ error: "poll not found." }, { status: 404 });
      }
      logPublicMutationError("vote-create-rpc", rpcError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      logPublicMutationError("vote-create-empty-rpc-result", new Error("RPC returned no row."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        id: row.id,
        votes: row.votes,
        participants: row.participants,
        optionIndex: row.option_index,
      },
      mode: "rpc",
    });
  } catch (error) {
    logPublicMutationError("vote-create-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.voteMutation);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400 });
    }

    let body: VoteBody;
    try {
      body = (await request.json()) as VoteBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    const optionIndex = body?.optionIndex;
    if (!Number.isInteger(optionIndex)) {
      return NextResponse.json({ error: "optionIndex must be an integer." }, { status: 400 });
    }

    const voterId = typeof body?.voterId === "string" ? body.voterId.trim().toLowerCase() : "";
    if (!isValidVoterId(voterId)) {
      return NextResponse.json({ error: "voterId must be a valid UUID." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id,options,votes,participants")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      logPublicMutationError("vote-change-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    if (!poll) {
      return NextResponse.json({ error: "poll not found." }, { status: 404 });
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
      return NextResponse.json({ error: "poll data is invalid." }, { status: 409 });
    }

    if ((optionIndex as number) < 0 || (optionIndex as number) >= options.length) {
      return NextResponse.json({ error: "optionIndex is out of range." }, { status: 400 });
    }

    const { data: rpcData, error: rpcError } = await supabaseMutation.rpc("change_poll_vote", {
      p_poll_id: id,
      p_new_option_index: optionIndex as number,
      p_voter_id: voterId,
    });

    if (rpcError) {
      if (rpcError.code === "P0002") {
        return NextResponse.json({ error: "기존 투표를 찾을 수 없습니다." }, { status: 409 });
      }
      logPublicMutationError("vote-change-rpc", rpcError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      logPublicMutationError("vote-change-empty-rpc-result", new Error("RPC returned no row."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
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
    });
  } catch (error) {
    logPublicMutationError("vote-change-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
