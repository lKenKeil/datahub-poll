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
    return { ok: false, reason: "ADMIN_DASHBOARD_KEY is not configured on server." } as const;
  }

  if (!provided || provided !== expected) {
    return { ok: false, reason: "Invalid admin key." } as const;
  }

  return { ok: true } as const;
}
