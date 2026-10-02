import { NextResponse } from "next/server";
import { getSupabaseMutationClient } from "@/lib/supabase-server";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";
import { REPORT_DETAIL_MAX_LENGTH, REPORT_UUID_PATTERN } from "@/lib/content-reporting";
import { hashReporterId, isReportReason, moderationErrorResponse, normalizeReportTarget } from "@/lib/content-report-server";
import { getUnsafeTextInputMessage } from "@/lib/public-api-hardening";
import { getUnicodeCodePointLength } from "@/lib/unicode-length";

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, RATE_LIMIT_POLICIES.contentReport);
  if (limited) return limited;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 8192) return NextResponse.json({ error: "신고 내용이 너무 깁니다." }, { status: 400 });
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 8192) return NextResponse.json({ error: "신고 내용이 너무 깁니다." }, { status: 400 });
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(rawBody);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = value as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "신고 내용을 확인해주세요." }, { status: 400 });
    }
    const target = normalizeReportTarget(body.targetType, body.targetId);
    const reporterId = typeof body.reporterId === "string" ? body.reporterId.trim().toLowerCase() : "";
    if (!target || !REPORT_UUID_PATTERN.test(reporterId) || !isReportReason(body.reason)) {
      return NextResponse.json({ error: "신고 대상과 사유를 확인해주세요." }, { status: 400 });
    }
    if (body.detail !== undefined && body.detail !== null && typeof body.detail !== "string") {
      return NextResponse.json({ error: "추가 설명을 확인해주세요." }, { status: 400 });
    }
    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    const unsafe = getUnsafeTextInputMessage([{ label: "추가 설명", value: detail }]);
    if (unsafe) return NextResponse.json({ error: unsafe }, { status: 400 });
    if (getUnicodeCodePointLength(detail) > REPORT_DETAIL_MAX_LENGTH || (body.reason !== "other" && detail)) {
      return NextResponse.json({ error: "기타 설명은 300자 이내로 입력해주세요." }, { status: 400 });
    }
    const { data, error } = await getSupabaseMutationClient().rpc("submit_content_report", {
      p_target_type: target.targetType,
      p_target_id: target.targetId,
      p_reporter_hash: hashReporterId(reporterId),
      p_reason: body.reason,
      p_detail: detail || null,
    });
    if (error) return moderationErrorResponse(error, "report-submit");
    if (!data || typeof data.duplicate !== "boolean") return moderationErrorResponse({}, "report-submit-result");
    return NextResponse.json({ ok: true, duplicate: data.duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return moderationErrorResponse(error, "report-submit-unexpected");
  }
}
