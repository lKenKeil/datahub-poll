import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

type VoteBody = {
  optionIndex: number;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as VoteBody;

  const rpcPayload = {
    p_poll_id: id,
    p_option_index: body.optionIndex,
    p_title: body.title,
    p_category: body.category,
    p_options: body.options,
    p_seed_votes: body.votes,
    p_seed_participants: body.participants,
  };

  const { data: rpcData, error: rpcError } = await supabaseServer.rpc("increment_poll_vote", rpcPayload);

  if (!rpcError && rpcData) {
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    return NextResponse.json({ data: row, mode: "rpc" });
  }

  const fallbackVotes = [...body.votes];
  fallbackVotes[body.optionIndex] = (fallbackVotes[body.optionIndex] ?? 0) + 1;

  const { error: fallbackError } = await supabaseServer.from("polls").upsert({
    id,
    title: body.title,
    category: body.category,
    options: body.options,
    votes: fallbackVotes,
    participants: body.participants + 1,
  });

  if (fallbackError) {
    return NextResponse.json({ error: fallbackError.message }, { status: 500 });
  }

  return NextResponse.json({
    data: { id, votes: fallbackVotes, participants: body.participants + 1 },
    mode: "upsert",
  });
}
