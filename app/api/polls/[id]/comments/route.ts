import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

type CommentBody = {
  text: string;
  title: string;
  category: string;
  options: string[];
  votes: number[];
  participants: number;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as CommentBody;

  const { error: ensurePollError } = await supabaseServer.from("polls").upsert({
    id,
    title: body.title,
    category: body.category,
    options: body.options,
    votes: body.votes,
    participants: body.participants,
  });

  if (ensurePollError) {
    return NextResponse.json({ error: ensurePollError.message }, { status: 500 });
  }

  const { data, error } = await supabaseServer
    .from("comments")
    .insert({
      poll_id: id,
      text: body.text,
      user_name: "익명 유저",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
