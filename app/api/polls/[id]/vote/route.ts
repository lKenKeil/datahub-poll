import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

type VoteBody = {
  optionIndex?: unknown;
};

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200) {
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

    const { data: poll, error: pollError } = await supabaseServer
      .from("polls")
      .select("id,title,category,options,votes,participants")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      return NextResponse.json({ error: pollError.message }, { status: 500 });
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

    // The deployed RPC still has legacy seed parameters. Every value here is
    // loaded from the database, never accepted from the client request.
    const rpcPayload = {
      p_poll_id: id,
      p_option_index: optionIndex as number,
      p_title: poll.title,
      p_category: poll.category,
      p_options: options,
      p_seed_votes: votes,
      p_seed_participants: participants,
    };

    const { data: rpcData, error: rpcError } = await supabaseServer.rpc("increment_poll_vote", rpcPayload);

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row) {
      return NextResponse.json({ error: "vote update returned no data." }, { status: 500 });
    }

    return NextResponse.json({ data: row, mode: "rpc" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `vote API failed: ${message}` }, { status: 500 });
  }
}
