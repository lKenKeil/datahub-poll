import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "@/lib/auth-server";
import {
  isValidPollOwnerToken,
  verifyPollOwnerToken,
} from "@/lib/poll-owner-token";

export const POLL_OWNER_TOKEN_HEADER = "x-poll-owner-token";

export type PollOwnerAuthorizationResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 500; reason: "forbidden" | "not_found" | "internal"; error?: unknown };

export function readOfficialPublisher(supabase: SupabaseClient, userId: string) {
  return supabase.from("official_poll_publishers").select("active").eq("user_id", userId).maybeSingle();
}

export async function authorizePollOwner(
  request: Request,
  pollId: string,
  supabase: SupabaseClient,
): Promise<PollOwnerAuthorizationResult> {
  const token = request.headers.get(POLL_OWNER_TOKEN_HEADER)?.trim();

  const { data: ownership, error: ownershipError } = await supabase
    .from("poll_ownership")
    .select("owner_token_hash")
    .eq("poll_id", pollId)
    .maybeSingle();

  if (ownershipError) {
    return { ok: false, status: 500, reason: "internal", error: ownershipError };
  }

  if (!ownership) {
    if (!isValidPollOwnerToken(token)) return { ok: false, status: 403, reason: "forbidden" };
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("id")
      .eq("id", pollId)
      .maybeSingle();

    if (pollError) {
      return { ok: false, status: 500, reason: "internal", error: pollError };
    }

    return poll
      ? { ok: false, status: 403, reason: "forbidden" }
      : { ok: false, status: 404, reason: "not_found" };
  }

  const accountManaged = ownership.owner_token_hash === null;
  if (!accountManaged && !verifyPollOwnerToken(token, ownership.owner_token_hash)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }

  const { user, response } = await requireAuthenticatedUser(request);
  if (response?.status === 403) return { ok: false, status: 403, reason: "forbidden" };
  if (accountManaged) {
    if (!user) return { ok: false, status: 403, reason: "forbidden" };
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("author_user_id")
      .eq("id", pollId)
      .maybeSingle();
    if (pollError) return { ok: false, status: 500, reason: "internal", error: pollError };
    if (!poll) return { ok: false, status: 404, reason: "not_found" };
    if (poll.author_user_id !== user.id) return { ok: false, status: 403, reason: "forbidden" };
  }
  if (user) {
    const { data: publisher, error } = await readOfficialPublisher(supabase, user.id);
    if (error) return { ok: false, status: 500, reason: "internal", error };
    if (accountManaged ? publisher?.active !== true : Boolean(publisher)) {
      return { ok: false, status: 403, reason: "forbidden" };
    }
  }

  return { ok: true };
}
