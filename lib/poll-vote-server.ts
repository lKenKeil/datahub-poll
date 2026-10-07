import "server-only";
import { NextResponse } from "next/server";
import type { getSupabaseMutationClient } from "@/lib/supabase-server";
import type { PollVoteActor } from "@/lib/poll-vote-identity";

export const PRIVATE_VOTE_HEADERS = { "Cache-Control": "private, no-store" };

export type PollViewerVote = { optionIndex: number; canChangeVote: boolean };

// Resolve participation separately from ownership. The browser keeps its
// result across account changes without learning whose account owns the row.
// This helper only reads the ledger; reconciliation is an explicit POST.
export async function getPollViewerVote(
  client: ReturnType<typeof getSupabaseMutationClient>,
  pollId: string,
  actor: PollVoteActor,
  legacyVoterId = "",
): Promise<PollViewerVote | null> {
  if (!actor.viewerVerified) return null;
  if (actor.userId) {
    const { data: accountVote, error } = await client.from("poll_votes")
      .select("option_index").eq("poll_id", pollId).eq("user_id", actor.userId).maybeSingle();
    if (error) throw error;
    if (accountVote && Number.isInteger(accountVote.option_index)) {
      return { optionIndex: accountVote.option_index, canChangeVote: true };
    }
  }
  if (actor.guestHash) {
    const { data: browserVote, error } = await client.from("poll_votes")
      .select("option_index,user_id").eq("poll_id", pollId).eq("guest_id_hash", actor.guestHash).maybeSingle();
    if (error) throw error;
    if (browserVote && Number.isInteger(browserVote.option_index)) {
      return { optionIndex: browserVote.option_index, canChangeVote: browserVote.user_id == null };
    }
  }
  if (legacyVoterId) {
    const { data: legacyVote, error } = await client.from("poll_votes")
      .select("option_index").eq("poll_id", pollId).eq("voter_id", legacyVoterId)
      .is("user_id", null).is("guest_id_hash", null).maybeSingle();
    if (error) throw error;
    if (legacyVote && Number.isInteger(legacyVote.option_index)) {
      return { optionIndex: legacyVote.option_index, canChangeVote: true };
    }
  }
  return null;
}

export function isAccountVotingMigrationMissing(error: unknown) {
  const record = error && typeof error === "object"
    ? error as { code?: string; message?: string }
    : {};
  const message = record.message ?? "";
  return ((record.code === "PGRST202" || record.code === "42883")
      && /(?:cast|change|claim)_(?:authenticated|guest)_poll_vote/.test(message))
    || ((record.code === "42703" || record.code === "PGRST204")
      && (message.includes("user_id") || message.includes("guest_id_hash")))
    || ((record.code === "42P01" || record.code === "PGRST205")
      && message.includes("poll_votes"));
}

export function accountVotingMigrationResponse() {
  return NextResponse.json(
    {
      code: "DUAL_VOTING_MIGRATION_REQUIRED",
      error: "투표 기능을 준비 중입니다. 잠시 후 다시 시도해주세요.",
    },
    { status: 503, headers: PRIVATE_VOTE_HEADERS },
  );
}

export function withPrivateVoteHeaders<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", PRIVATE_VOTE_HEADERS["Cache-Control"]);
  return response;
}
