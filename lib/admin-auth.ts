import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

export function getAdminKeyFromRequest(request: Request) {
  return request.headers.get("x-admin-key")?.trim() ?? "";
}

export function getConfiguredAdminKey() {
  return process.env.ADMIN_DASHBOARD_KEY?.trim() ?? "";
}

export function isAdminAuthorized(request: Request) {
  const expected = getConfiguredAdminKey();
  const provided = getAdminKeyFromRequest(request);

  if (!expected) {
    return { ok: false, reason: "관리자 인증을 확인해주세요." } as const;
  }

  if (!provided || !timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  )) {
    return { ok: false, reason: "관리자 인증을 확인해주세요." } as const;
  }

  return { ok: true } as const;
}

export function requireAdminAuthorization(request: Request): Response | null {
  const auth = isAdminAuthorized(request);
  if (auth.ok) return null;
  return enforceRateLimit(request, RATE_LIMIT_POLICIES.adminAuthFailure)
    ?? Response.json({ error: auth.reason }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
