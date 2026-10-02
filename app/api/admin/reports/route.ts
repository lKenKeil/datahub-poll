import { NextResponse } from "next/server";
import { requireAdminAuthorization } from "@/lib/admin-auth";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { moderationErrorResponse } from "@/lib/content-report-server";

export async function GET(request: Request) {
  const denied = requireAdminAuthorization(request);
  if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "pending";
    const offset = Number(params.get("offset") ?? "0");
    if (!["pending", "handled", "all"].includes(status) || !Number.isSafeInteger(offset) || offset < 0) {
      return NextResponse.json({ error: "조회 조건을 확인해주세요." }, { status: 400 });
    }
    const { data, error } = await getSupabaseMutationClient().rpc("get_content_report_queue", {
      p_status: status, p_limit: 50, p_offset: offset,
    });
    if (error) return moderationErrorResponse(error, "admin-report-queue");
    if (!data || !Array.isArray(data.data)) return moderationErrorResponse({}, "admin-report-queue-result");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "admin-report-queue-unexpected");
  }
}
