import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { isAdminAuthorized } from "@/lib/admin-auth";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    patch.category = body.category.trim();
  }
  if (Array.isArray(body.options)) {
    const options = body.options.map((v) => String(v).trim()).filter(Boolean);
    if (options.length >= 2) {
      patch.options = options;
      // Keep vote array length aligned with options.
      patch.votes = options.map((_, idx) => {
        const prev = Array.isArray(body.votes) ? Number(body.votes[idx]) : 0;
        return Number.isFinite(prev) && prev >= 0 ? Math.round(prev) : 0;
      });
      patch.participants = (patch.votes as number[]).reduce((acc, n) => acc + n, 0);
    }
  }
  if (typeof body.official_fact === "string") {
    patch.official_fact = body.official_fact.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("polls")
    .update(patch)
    .eq("id", id)
    .select("id,title,category,options,votes,participants,official_fact,created_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: Request, context: Context) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const { id } = await context.params;

  const { data: comments, error: commentsError } = await supabaseServer
    .from("comments")
    .select("id")
    .eq("poll_id", id);

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  const commentIds = (comments ?? []).map((row) => String((row as { id: string }).id));
  if (commentIds.length > 0) {
    const { error: reactionsDeleteError } = await supabaseServer
      .from("comment_reactions")
      .delete()
      .in("comment_id", commentIds);

    if (reactionsDeleteError) {
      return NextResponse.json({ error: reactionsDeleteError.message }, { status: 500 });
    }
  }

  const { error: commentsDeleteError } = await supabaseServer
    .from("comments")
    .delete()
    .eq("poll_id", id);

  if (commentsDeleteError) {
    return NextResponse.json({ error: commentsDeleteError.message }, { status: 500 });
  }

  const { error: pollDeleteError } = await supabaseServer
    .from("polls")
    .delete()
    .eq("id", id);

  if (pollDeleteError) {
    return NextResponse.json({ error: pollDeleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
