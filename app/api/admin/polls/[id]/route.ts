import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  cleanupPollOptionImagesAfterDeletion,
  getPollOptionImagePathsForDeletion,
} from "@/lib/poll-option-image-cleanup";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = isAdminAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  const supabaseMutation = getSupabaseMutationClient();

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

  const { data, error } = await supabaseMutation
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

  const supabaseMutation = getSupabaseMutationClient();

  const { id } = await context.params;

  const { data: poll, error: pollError } = await supabaseMutation
    .from("polls")
    .select("id,option_image_paths")
    .eq("id", id)
    .maybeSingle();

  if (pollError) {
    return NextResponse.json({ error: pollError.message }, { status: 500 });
  }

  if (!poll) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 });
  }

  const rawImagePaths = (poll as { option_image_paths?: unknown }).option_image_paths;
  const imagePaths = getPollOptionImagePathsForDeletion(id, rawImagePaths);
  const storedPathCount = Array.isArray(rawImagePaths)
    ? rawImagePaths.filter((value) => typeof value === "string").length
    : 0;

  if (storedPathCount > imagePaths.length) {
    console.warn("Skipped invalid poll option image paths during poll deletion.", {
      pollId: id,
      skippedPathCount: storedPathCount - imagePaths.length,
    });
  }

  const { data: comments, error: commentsError } = await supabaseMutation
    .from("comments")
    .select("id")
    .eq("poll_id", id);

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  const commentIds = (comments ?? []).map((row) => String((row as { id: string }).id));
  if (commentIds.length > 0) {
    const { error: reactionsDeleteError } = await supabaseMutation
      .from("comment_reactions")
      .delete()
      .in("comment_id", commentIds);

    if (reactionsDeleteError) {
      return NextResponse.json({ error: reactionsDeleteError.message }, { status: 500 });
    }
  }

  const { error: commentsDeleteError } = await supabaseMutation
    .from("comments")
    .delete()
    .eq("poll_id", id);

  if (commentsDeleteError) {
    return NextResponse.json({ error: commentsDeleteError.message }, { status: 500 });
  }

  const { data: deletedPoll, error: pollDeleteError } = await supabaseMutation
    .from("polls")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (pollDeleteError) {
    return NextResponse.json({ error: pollDeleteError.message }, { status: 500 });
  }

  if (!deletedPoll) {
    return NextResponse.json({ error: "Poll was not deleted." }, { status: 409 });
  }

  if (imagePaths.length > 0) {
    await cleanupPollOptionImagesAfterDeletion(supabaseMutation, id, imagePaths);
  }

  return NextResponse.json({ ok: true });
}
