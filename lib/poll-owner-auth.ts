import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "@/lib/auth-server";
import { getOfficialAccountUserId } from "@/lib/official-account-server";
import {
  isValidPollOwnerToken,
  verifyPollOwnerToken,
} from "@/lib/poll-owner-token";

export const POLL_OWNER_TOKEN_HEADER = "x-poll-owner-token";

export type PollOwnerAuthorizationResult =
  | { ok: true }
  | { ok: false; status: 403 | 404 | 500; reason: "forbidden" | "not_found" | "internal"; error?: unknown };

export async function authorizePollOwner(
  request: Request,
  pollId: string,
  supabase: SupabaseClient,
): Promise<PollOwnerAuthorizationResult> {
  const token = request.headers.get(POLL_OWNER_TOKEN_HEADER)?.trim();
  if (!isValidPollOwnerToken(token)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }

  const { data: ownership, error: ownershipError } = await supabase
    .from("poll_ownership")
    .select("owner_token_hash")
    .eq("poll_id", pollId)
    .maybeSingle();

  if (ownershipError) {
    return { ok: false, status: 500, reason: "internal", error: ownershipError };
  }

  if (!ownership) {
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

  if (!verifyPollOwnerToken(token, ownership.owner_token_hash)) {
    return { ok: false, status: 403, reason: "forbidden" };
  }

  const officialAccountId = getOfficialAccountUserId();
  if (officialAccountId) {
    const { data: poll, error: pollError } = await supabase
      .from("polls")
      .select("author_user_id")
      .eq("id", pollId)
      .maybeSingle();
    if (pollError) return { ok: false, status: 500, reason: "internal", error: pollError };
    if (!poll) return { ok: false, status: 404, reason: "not_found" };

    const { user, response } = await requireAuthenticatedUser(request);
    const isOfficialPoll = poll.author_user_id === officialAccountId;
    const isOfficialUser = user?.id === officialAccountId;
    // The existing token is still required. A verified publisher session is
    // bound to its own polls, even if another poll's token is supplied.
    if (response?.status === 403 || isOfficialPoll !== isOfficialUser) {
      return { ok: false, status: 403, reason: "forbidden" };
    }
  }

  return { ok: true };
}
