import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  getUnsafeTextInputMessage,
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

type ReactionBody = {
  userFingerprint?: unknown;
  reaction?: unknown;
};

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.commentReaction);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "invalid comment id." }, { status: 400 });
    }

    let body: ReactionBody;
    try {
      body = (await request.json()) as ReactionBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body." }, { status: 400 });
    }

    const rawUserFingerprint = typeof body.userFingerprint === "string" ? body.userFingerprint : "";
    const unsafeInputMessage = getUnsafeTextInputMessage([
      { label: "사용자 식별값", value: rawUserFingerprint },
    ]);
    if (unsafeInputMessage) {
      return NextResponse.json({ error: unsafeInputMessage }, { status: 400 });
    }

    const userFingerprint = rawUserFingerprint.trim();
    if (!userFingerprint || userFingerprint.length > 200) {
      return NextResponse.json({ error: "userFingerprint must be 1-200 chars." }, { status: 400 });
    }

    if (body.reaction !== null && body.reaction !== "like" && body.reaction !== "dislike") {
      return NextResponse.json({ error: "reaction must be like, dislike, or null." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: comment, error: commentError } = await supabaseMutation
      .from("comments")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (commentError) {
      logPublicMutationError("comment-reaction-comment-read", commentError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    if (!comment) {
      return NextResponse.json({ error: "comment not found." }, { status: 404 });
    }

    if (body.reaction === null) {
      const { error } = await supabaseMutation
        .from("comment_reactions")
        .delete()
        .eq("comment_id", id)
        .eq("user_fingerprint", userFingerprint);

      if (error) {
        logPublicMutationError("comment-reaction-delete", error);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
      }
    } else {
      const { error } = await supabaseMutation.from("comment_reactions").upsert(
        {
          comment_id: id,
          user_fingerprint: userFingerprint,
          reaction: body.reaction,
        },
        { onConflict: "comment_id,user_fingerprint" },
      );

      if (error) {
        logPublicMutationError("comment-reaction-upsert", error);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
      }
    }

    const { data: reactions, error: countError } = await supabaseMutation
      .from("comment_reactions")
      .select("reaction,user_fingerprint")
      .eq("comment_id", id);

    if (countError) {
      logPublicMutationError("comment-reaction-count", countError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    const rows = (reactions ?? []) as Array<{ reaction: "like" | "dislike"; user_fingerprint: string }>;
    const likeCount = rows.filter((row) => row.reaction === "like").length;
    const dislikeCount = rows.filter((row) => row.reaction === "dislike").length;
    const my = rows.find((row) => row.user_fingerprint === userFingerprint)?.reaction ?? null;

    return NextResponse.json({ likeCount, dislikeCount, userReaction: my });
  } catch (error) {
    logPublicMutationError("comment-reaction-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
