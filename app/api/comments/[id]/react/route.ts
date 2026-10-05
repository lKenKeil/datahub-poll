import { NextResponse } from "next/server";
import { getCommentReactionActor } from '@/lib/comment-reaction-identity';
import { CommentIdentityUnavailable, setGuestCommentCookie } from '@/lib/comment-identity';
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { normalizeReportTarget, moderationErrorResponse } from "@/lib/content-report-server";
import {
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

type ReactionBody = {
  reaction?: unknown;
};

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.commentReaction);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const actor = await getCommentReactionActor(request);
    if (actor.response) return actor.response;
    const { id } = await context.params;
    if (!normalizeReportTarget("comment", id) || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "invalid comment id." }, { status: 400 });
    }

    let body: ReactionBody;
    try {
      body = (await request.json()) as ReactionBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    if (!body || (body.reaction !== "like" && body.reaction !== "dislike")) {
      return NextResponse.json({ error: "reaction must be like or dislike." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: comment, error: commentError } = await supabaseMutation
      .from("comments")
      .select("id,poll_id,is_hidden")
      .eq("id", id)
      .maybeSingle();

    if (commentError) {
      return moderationErrorResponse(commentError, "comment-reaction-comment-read");
    }

    if (!comment || comment.is_hidden) {
      return NextResponse.json({ error: "comment not found." }, { status: 404 });
    }

    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls").select("id,is_hidden").eq("id", comment.poll_id).maybeSingle();
    if (pollError) return moderationErrorResponse(pollError, "comment-reaction-poll-read");
    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "의견을 찾을 수 없습니다." }, { status: 404 });
    }

    // The RPC holds the same poll-first lock used by moderation and vote
    // mutations, rechecks visibility, then applies and counts the reaction.
    const { data, error } = await supabaseMutation.rpc("toggle_comment_reaction_with_actor", {
      p_comment_id: id.toLowerCase(),
      p_actor_key: actor.key,
      p_reaction: body.reaction,
    });
    if (error) return moderationErrorResponse(error, "comment-reaction-rpc");
    if (!data || !Number.isInteger(data.likeCount) || !Number.isInteger(data.dislikeCount)
      || data.likeCount < 0 || data.dislikeCount < 0
      || ![null, 'like', 'dislike'].includes(data.userReaction)) {
      logPublicMutationError("comment-reaction-empty-result", new Error("Invalid reaction result."));
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }
    const response = NextResponse.json({
      likeCount: data.likeCount, dislikeCount: data.dislikeCount, userReaction: data.userReaction,
    }, { headers: { "Cache-Control": "no-store" } });
    setGuestCommentCookie(response, actor.newCookie, request);
    return response;
  } catch (error) {
    if (error instanceof CommentIdentityUnavailable) return NextResponse.json({ error: '반응 기능을 준비 중이에요.' }, { status: 503 });
    logPublicMutationError("comment-reaction-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
