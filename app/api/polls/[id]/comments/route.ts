import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth-server";
import { accountErrorResponse, ensureAccountProfile } from "@/lib/profile-server";
import { serializePublicComment } from "@/lib/public-identity";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import {
  getUnsafeTextInputMessage,
  hasUnsafeInputControlCharacters,
  logPublicMutationError,
  PUBLIC_INTERNAL_ERROR_MESSAGE,
} from "@/lib/public-api-hardening";
import { getUnicodeCodePointLength } from "@/lib/unicode-length";
import { isModerationMigrationMissing, moderationErrorResponse, normalizeReportTarget } from "@/lib/content-report-server";

type Context = { params: Promise<{ id: string }> };

type CommentBody = {
  text?: unknown;
  parentId?: unknown;
  isAnonymous?: unknown;
};

export async function POST(request: Request, context: Context) {
  const rateLimitResponse = enforceRateLimit(request, RATE_LIMIT_POLICIES.commentCreate);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
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

    if (body.isAnonymous !== undefined && typeof body.isAnonymous !== "boolean") {
      return NextResponse.json({ error: "isAnonymous must be a boolean." }, { status: 400 });
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
    if (!text || getUnicodeCodePointLength(text) > 2000) {
      return NextResponse.json({ error: "comment text must be 1-2000 chars." }, { status: 400 });
    }

    const parentId = rawParentId.trim().toLowerCase();
    if (parentId && !normalizeReportTarget("comment", parentId)) {
      return NextResponse.json({ error: "invalid parentId." }, { status: 400 });
    }

    const supabaseMutation = getSupabaseMutationClient();
    const { data: poll, error: pollError } = await supabaseMutation
      .from("polls")
      .select("id,is_hidden")
      .eq("id", id)
      .maybeSingle();

    if (pollError) {
      if (isModerationMigrationMissing(pollError)) return moderationErrorResponse(pollError, "comment-create-poll-read");
      logPublicMutationError("comment-create-poll-read", pollError);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    if (!poll || poll.is_hidden) {
      return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404 });
    }

    if (parentId) {
      const { data: parent, error: parentError } = await supabaseMutation
        .from("comments")
        .select("id,is_hidden")
        .eq("id", parentId)
        .eq("poll_id", id)
        .maybeSingle();

      if (parentError) {
        logPublicMutationError("comment-create-parent-read", parentError);
        return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
      }

      if (!parent || parent.is_hidden) {
        return NextResponse.json({ error: "의견을 찾을 수 없습니다." }, { status: 404 });
      }
    }

    const isAnonymous = body.isAnonymous === true;
    // Anonymous authors are still authenticated; public identity is masked only.
    const profile = isAnonymous ? null : await ensureAccountProfile(supabaseMutation, auth.user.id);
    const insertPayload: Record<string, unknown> = {
      poll_id: id,
      text,
      user_name: isAnonymous ? "익명" : profile!.nickname,
      user_id: auth.user.id,
      is_anonymous: isAnonymous,
    };

    if (parentId) {
      insertPayload.parent_id = parentId;
    }

    const { data, error } = await supabaseMutation
      .from("comments")
      .insert(insertPayload)
      .select("id,poll_id,parent_id,text,user_name,created_at,is_anonymous")
      .single();

    if (error) {
      if (error.code === "P0002") {
        return NextResponse.json({ error: "질문 또는 의견을 찾을 수 없습니다." }, { status: 404 });
      }
      if (isModerationMigrationMissing(error)) return moderationErrorResponse(error, "comment-create-db-insert");
      logPublicMutationError("comment-create-db-insert", error);
      return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500 });
    }

    return NextResponse.json({
      data: serializePublicComment({ ...data, is_anonymous: isAnonymous }, profile, true),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return accountErrorResponse(error, "comment-create-unexpected");
  }
}
