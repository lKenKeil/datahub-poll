import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  const [{ data: poll, error: pollError }, { data: comments, error: commentsError }] = await Promise.all([
    supabaseServer.from("polls").select("*").eq("id", id).maybeSingle(),
    supabaseServer
      .from("comments")
      .select("*")
      .eq("poll_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (pollError) {
    return NextResponse.json({ error: pollError.message }, { status: 500 });
  }

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  return NextResponse.json({ poll: poll ?? null, comments: comments ?? [] });
}
