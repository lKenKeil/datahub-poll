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
  parentId?: string | null;
};

export async function POST(request: Request, context: Context) {
  try {
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

    const insertPayload: Record<string, unknown> = {
      poll_id: id,
      text: body.text,
      user_name: "익명 유저",
    };

    if (body.parentId) {
      insertPayload.parent_id = body.parentId;
    }

    const { data, error } = await supabaseServer
      .from("comments")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `comments API failed: ${message}` }, { status: 500 });
  }
}
