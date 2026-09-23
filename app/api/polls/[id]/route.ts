import { NextResponse } from "next/server";
import { getSupabaseMutationClient, supabaseServer } from "@/lib/supabase-server";
import { isValidVoterId } from "@/lib/voter-id";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const userFingerprint = _.headers.get("x-user-fp")?.trim() ?? "";
  const voterId = _.headers.get("x-voter-id")?.trim().toLowerCase() ?? "";

  if (voterId && !isValidVoterId(voterId)) {
    return NextResponse.json({ error: "invalid voter id." }, { status: 400 });
  }

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

  let viewerVote: { optionIndex: number } | null = null;
  if (voterId) {
    const supabaseMutation = getSupabaseMutationClient();
    const { data: vote, error: voteError } = await supabaseMutation
      .from("poll_votes")
      .select("option_index")
      .eq("poll_id", id)
      .eq("voter_id", voterId)
      .maybeSingle();

    if (voteError) {
      return NextResponse.json({ error: voteError.message }, { status: 500 });
    }

    if (vote && Number.isInteger(vote.option_index)) {
      viewerVote = { optionIndex: vote.option_index };
    }
  }

  const commentRows = (comments ?? []) as Array<Record<string, unknown>>;
  const commentIds = commentRows.map((row) => String(row.id));

  if (commentIds.length === 0) {
    return NextResponse.json({ poll: poll ?? null, comments: [], viewerVote });
  }

  const { data: reactions, error: reactionsError } = await supabaseServer
    .from("comment_reactions")
    .select("comment_id,reaction,user_fingerprint")
    .in("comment_id", commentIds);

  if (reactionsError) {
    return NextResponse.json({ error: reactionsError.message }, { status: 500 });
  }

  const reactionRows = (reactions ?? []) as Array<{
    comment_id: string;
    reaction: "like" | "dislike";
    user_fingerprint: string;
  }>;

  const byComment = new Map<string, { like: number; dislike: number; userReaction: "like" | "dislike" | null }>();

  for (const commentId of commentIds) {
    byComment.set(commentId, { like: 0, dislike: 0, userReaction: null });
  }

  for (const row of reactionRows) {
    const bucket = byComment.get(row.comment_id);
    if (!bucket) continue;

    if (row.reaction === "like") bucket.like += 1;
    if (row.reaction === "dislike") bucket.dislike += 1;

    if (userFingerprint && row.user_fingerprint === userFingerprint) {
      bucket.userReaction = row.reaction;
    }
  }

  const enriched = commentRows.map((row) => {
    const key = String(row.id);
    const meta = byComment.get(key) ?? { like: 0, dislike: 0, userReaction: null };
    return {
      ...row,
      parent_id: (row.parent_id as string | null | undefined) ?? null,
      like_count: meta.like,
      dislike_count: meta.dislike,
      user_reaction: meta.userReaction,
    };
  });

  return NextResponse.json({ poll: poll ?? null, comments: enriched, viewerVote });
}
