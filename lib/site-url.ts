import 'server-only';

const LOCAL_SITE_URL = 'http://localhost:3000';

function parseSiteUrl(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  const hasProtocol = /^https?:\/\//i.test(candidate);
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(candidate);
  const normalized = hasProtocol ? candidate : `${isLocalHost ? 'http' : 'https'}://${candidate}`;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

export function getSiteUrl() {
  const configuredUrl =
    parseSiteUrl(process.env.SITE_URL)
    ?? parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)
    ?? parseSiteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? parseSiteUrl(process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL)
    ?? parseSiteUrl(process.env.VERCEL_URL)
    ?? parseSiteUrl(process.env.NEXT_PUBLIC_VERCEL_URL);

  return configuredUrl ?? new URL(LOCAL_SITE_URL);
}
