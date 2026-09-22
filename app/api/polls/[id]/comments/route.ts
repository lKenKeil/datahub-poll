import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Context = { params: Promise<{ id: string }> };

type CommentBody = {
  text?: unknown;
  parentId?: unknown;
};

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200) {
      return NextResponse.json({ error: "invalid poll id." }, { status: 400 });
    }

    let body: CommentBody;
    try {
      body = (await request.json()) as CommentBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    if (typeof body?.text !== "string") {
      return NextResponse.json({ error: "comment text is required." }, { status: 400 });
    }

    const text = body.text.trim();
    if (!text || text.length > 2000) {
      return NextResponse.json({ error: "comment text must be 1-2000 chars." }, { status: 400 });
    }

    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
      return NextResponse.json({ error: "parentId must be a string or null." }, { status: 400 });
    }

    const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
    if (parentId.length > 200) {
      return NextResponse.json({ error: "parentId is too long." }, { status: 400 });
    }

    const { data: poll, error: pollError } = await supabaseServer
      .from("polls")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      return NextResponse.json({ error: pollError.message }, { status: 500 });
    }

    if (!poll) {
      return NextResponse.json({ error: "poll not found." }, { status: 404 });
    }

    if (parentId) {
      const { data: parent, error: parentError } = await supabaseServer
        .from("comments")
        .select("id")
        .eq("id", parentId)
        .eq("poll_id", id)
        .maybeSingle();

      if (parentError) {
        return NextResponse.json({ error: parentError.message }, { status: 500 });
      }

      if (!parent) {
        return NextResponse.json({ error: "parent comment not found for this poll." }, { status: 400 });
      }
    }

    const insertPayload: Record<string, unknown> = {
      poll_id: id,
      text,
      user_name: "익명 유저",
    };

    if (parentId) {
      insertPayload.parent_id = parentId;
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
