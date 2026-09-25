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

type CommentBody = {
  text?: unknown;
  parentId?: unknown;
};

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.commentCreate);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
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

    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
      return NextResponse.json({ error: "parentId must be a string or null." }, { status: 400 });
    }

    const rawParentId = typeof body.parentId === "string" ? body.parentId : "";
    const unsafeInputMessage = getUnsafeTextInputMessage([
      { label: "댓글", value: body.text },
      { label: "답글 대상", value: rawParentId },
    ]);
    if (unsafeInputMessage) {
      return NextResponse.json({ error: unsafeInputMessage }, { status: 400 });
    }

    const text = body.text.trim();
    if (!text || text.length > 2000) {
      return NextResponse.json({ error: "comment text must be 1-2000 chars." }, { status: 400 });
    }

    const parentId = rawParentId.trim();
    if (parentId.length > 200) {
      return NextResponse.json({ error: "parentId is too long." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      logPublicMutationError("comment-create-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    if (!poll) {
      return NextResponse.json({ error: "poll not found." }, { status: 404 });
    }

    if (parentId) {
      const { data: parent, error: parentError } = await supabaseMutation
        .from("comments")
        .select("id")
        .eq("id", parentId)
        .eq("poll_id", id)
        .maybeSingle();

      if (parentError) {
        logPublicMutationError("comment-create-parent-read", parentError);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
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

    const { data, error } = await supabaseMutation
      .from("comments")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      logPublicMutationError("comment-create-db-insert", error);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    logPublicMutationError("comment-create-unexpected", error);
    return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}
