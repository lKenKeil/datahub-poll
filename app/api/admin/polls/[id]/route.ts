import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { requireAdminAuthorization } from "@/lib/admin-auth";
import { deletePollWithImageCleanup } from "@/lib/poll-deletion";
import { moderationErrorResponse } from "@/lib/content-report-server";
import { hasUnsafeInputControlCharacters } from "@/lib/public-api-hardening";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const denied = requireAdminAuthorization(request);
  if (denied) return denied;
  try {
    const supabaseMutation = getSupabaseMutationClient();

    const { id } = await context.params;
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "수정 내용을 확인해주세요." }, { status: 400 });
    }
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "수정할 투표를 확인해주세요." }, { status: 400 });
    }

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
      return NextResponse.json({ error: "수정할 내용을 확인해주세요." }, { status: 400 });
    }

    const { data, error } = await supabaseMutation
      .from("polls")
      .update(patch)
      .eq("id", id)
      .eq("is_hidden", false)
      .select("id,title,category,options,votes,participants,official_fact,created_at")
      .maybeSingle();

    if (error) {
      return moderationErrorResponse(error, "admin-poll-update");
    }

    if (!data) return NextResponse.json({ error: "투표를 찾을 수 없거나 숨김 상태입니다." }, { status: 404 });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "admin-poll-update-unexpected");
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = requireAdminAuthorization(request);
  if (denied) return denied;
  try {
    const supabaseMutation = getSupabaseMutationClient();

    const { id } = await context.params;
    if (!id.trim() || id.length > 200 || hasUnsafeInputControlCharacters(id)) {
      return NextResponse.json({ error: "삭제할 투표를 확인해주세요." }, { status: 400 });
    }

    const result = await deletePollWithImageCleanup(supabaseMutation, id);
    if (!result.ok) {
      return moderationErrorResponse(result.reason === "not_found" ? { code: "P0002" } : result.error, "admin-poll-delete");
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "admin-poll-delete-unexpected");
  }
}
