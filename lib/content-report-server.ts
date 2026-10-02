import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { REPORT_REASONS, REPORT_UUID_PATTERN, type ReportTargetType } from "@/lib/content-reporting";
import { hasUnsafeInputControlCharacters, PUBLIC_INTERNAL_ERROR_MESSAGE } from "@/lib/public-api-hardening";

export function normalizeReportTarget(targetType: unknown, targetId: unknown):
  | { targetType: ReportTargetType; targetId: string }
  | null {
  if ((targetType !== "poll" && targetType !== "comment") || typeof targetId !== "string") return null;
  const id = targetId.trim();
  if (!id || id.length > 200 || hasUnsafeInputControlCharacters(id)) return null;
  if (targetType === "comment" && !REPORT_UUID_PATTERN.test(id)) return null;
  return { targetType, targetId: targetType === "comment" ? id.toLowerCase() : id };
}

export function isReportReason(reason: unknown) {
  return typeof reason === "string" && REPORT_REASONS.some((item) => item.value === reason);
}

export function hashReporterId(reporterId: string) {
  return createHash("sha256").update(`askio:content-report:reporter:v1\0${reporterId.toLowerCase()}`, "utf8").digest("hex");
}

export function isModerationMigrationMissing(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return record.code === "PGRST202" || record.code === "PGRST205" || record.code === "42P01" || record.code === "42703";
}

export function moderationErrorResponse(error: unknown, scope: string) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (record.code === "P0002") {
    return NextResponse.json({ error: "이 콘텐츠를 찾을 수 없거나 처리할 수 없습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (record.code === "22023" || record.code === "22P02") {
    return NextResponse.json({ error: "입력 내용을 확인해주세요." }, { status: 400 });
  }
  // Report detail, content text, credentials, and raw database errors are never logged.
  console.error(`[moderation:${scope}]`, { code: typeof record.code === "string" ? record.code.slice(0, 20) : "unknown" });
  if (isModerationMigrationMissing(error)) {
    return NextResponse.json(
      { code: "MODERATION_MIGRATION_REQUIRED", error: "신고·관리 기능을 준비 중입니다. 잠시 후 다시 시도해주세요." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ error: PUBLIC_INTERNAL_ERROR_MESSAGE }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
