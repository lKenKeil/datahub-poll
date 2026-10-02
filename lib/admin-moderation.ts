import "server-only";

import { NextResponse } from "next/server";
import { requireAdminAuthorization } from "@/lib/admin-auth";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { deletePollWithImageCleanup } from "@/lib/poll-deletion";
import { moderationErrorResponse, normalizeReportTarget } from "@/lib/content-report-server";
import type { ModerationAction } from "@/lib/content-reporting";

export async function handleAdminModeration(request: Request, action: ModerationAction) {
  const denied = requireAdminAuthorization(request);
  if (denied) return denied;
  try {
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "처리할 대상을 확인해주세요." }, { status: 400 });
    }
    const target = normalizeReportTarget(body.targetType, body.targetId);
    if (!target) return NextResponse.json({ error: "처리할 대상을 확인해주세요." }, { status: 400 });
    const client = getSupabaseMutationClient();
    if (action === "delete" && target.targetType === "poll") {
      const result = await deletePollWithImageCleanup(client, target.targetId);
      if (!result.ok) return moderationErrorResponse(result.reason === "not_found" ? { code: "P0002" } : result.error, "admin-report-delete-poll");
    } else if (action === "delete") {
      const { error } = await client.rpc("delete_comment_with_dependents", { p_comment_id: target.targetId });
      if (error) return moderationErrorResponse(error, "admin-report-delete-comment");
    } else {
      const { error } = await client.rpc("moderate_report_target", {
        p_target_type: target.targetType, p_target_id: target.targetId, p_action: action,
      });
      if (error) return moderationErrorResponse(error, "admin-report-action");
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "admin-report-action-unexpected");
  }
}
