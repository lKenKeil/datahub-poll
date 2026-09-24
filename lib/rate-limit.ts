import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type RateLimitPolicy = {
  key: string;
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitState = {
  buckets: Map<string, Bucket>;
  checks: number;
};

const globalRateLimit = globalThis as typeof globalThis & {
  __pollRateLimitState?: RateLimitState;
};

const state = globalRateLimit.__pollRateLimitState ?? {
  buckets: new Map<string, Bucket>(),
  checks: 0,
};

globalRateLimit.__pollRateLimitState = state;

export const RATE_LIMIT_POLICIES = {
  pollCreate: { key: "poll-create", limit: 5, windowMs: 10 * 60 * 1000 },
  voteMutation: { key: "vote-mutation", limit: 20, windowMs: 60 * 1000 },
  commentCreate: { key: "comment-create", limit: 10, windowMs: 60 * 1000 },
  commentReaction: { key: "comment-reaction", limit: 30, windowMs: 60 * 1000 },
} satisfies Record<string, RateLimitPolicy>;

function normalizeIp(rawValue: string | null) {
  if (!rawValue) return null;

  let candidate = rawValue.split(",", 1)[0]?.trim().toLowerCase() ?? "";
  if (!candidate) return null;

  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    if (closingBracket > 0) candidate = candidate.slice(1, closingBracket);
  } else if (candidate.includes(".") && candidate.lastIndexOf(":") > candidate.lastIndexOf(".")) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (candidate.startsWith("::ffff:")) {
    const mappedIpv4 = candidate.slice("::ffff:".length);
    if (isIP(mappedIpv4) === 4) candidate = mappedIpv4;
  }

  return isIP(candidate) ? candidate : null;
}

function getClientKey(request: Request) {
  const ip = normalizeIp(request.headers.get("x-vercel-forwarded-for"))
    ?? normalizeIp(request.headers.get("x-forwarded-for"))
    ?? normalizeIp(request.headers.get("x-real-ip"));

  if (!ip) return "unknown-client";
  return createHash("sha256").update(ip).digest("base64url");
}

function pruneExpiredBuckets(nowMs: number) {
  state.checks += 1;
  if (state.checks % 250 !== 0 && state.buckets.size < 5_000) return;

  for (const [key, bucket] of state.buckets) {
    if (bucket.resetAt <= nowMs) state.buckets.delete(key);
  }

  if (state.buckets.size <= 10_000) return;
  const overflow = state.buckets.size - 10_000;
  let removed = 0;
  for (const key of state.buckets.keys()) {
    state.buckets.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function enforceRateLimit(
  request: Request,
  policy: RateLimitPolicy,
  nowMs = Date.now(),
) {
  pruneExpiredBuckets(nowMs);

  const bucketKey = `${policy.key}:${getClientKey(request)}`;
  const existing = state.buckets.get(bucketKey);
  const bucket = !existing || existing.resetAt <= nowMs
    ? { count: 0, resetAt: nowMs + policy.windowMs }
    : existing;

  if (bucket.count >= policy.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000));
    return Response.json(
      {
        code: "RATE_LIMITED",
        error: "요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
      },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Limit": String(policy.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(bucket.resetAt / 1000)),
        },
      },
    );
  }

  bucket.count += 1;
  state.buckets.set(bucketKey, bucket);
  return null;
}
