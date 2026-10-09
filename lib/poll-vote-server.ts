import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { getSupabaseMutationClient } from "@/lib/supabase-server";
import type { PollVoteActor } from "@/lib/poll-vote-identity";

export const PRIVATE_VOTE_HEADERS = { "Cache-Control": "private, no-store" };

export type PollViewerVote = {
  optionIndex: number;
  canChangeVote: boolean;
  canCancelVote: boolean;
  managementToken?: string;
};

// Public question reads remain available during an Auth outage. A null vote
// in that response must not be mistaken for a verified, unvoted visitor.
export function getPollVoteIdentityStatus(actor: PollVoteActor): 'account' | 'guest' | 'unavailable' {
  if (!actor.viewerVerified) return 'unavailable';
  if (actor.userId) return 'account';
  return actor.guestHash ? 'guest' : 'unavailable';
}

function managementToken(pollId: string, rowId: string, actor: PollVoteActor) {
  const secret = process.env.GUEST_ID_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) throw new Error("Vote management identity is unavailable.");
  // Digest only: no ledger ID, account identifier, or guest hash is encoded
  // in the public value. It pins a mutation to the exact observed vote row.
  return createHmac("sha256", secret).update(JSON.stringify([
    "askio-vote-management-v1", pollId, rowId, actor.userId, actor.guestHash,
  ])).digest("hex");
}

export async function getPollVoteManagement(
  client: ReturnType<typeof getSupabaseMutationClient>,
  pollId: string,
  actor: PollVoteActor,
) {
  if (!actor.viewerVerified) return null;
  let vote: { id: unknown; option_index: number } | null = null;
  if (actor.userId) {
    const { data, error } = await client.from("poll_votes")
      .select("id,option_index").eq("poll_id", pollId).eq("user_id", actor.userId).maybeSingle();
    if (error) throw error;
    vote = data;
  }
  if (!vote && actor.guestHash) {
    const { data, error } = await client.from("poll_votes")
      .select("id,option_index").eq("poll_id", pollId).eq("guest_id_hash", actor.guestHash).maybeSingle();
    if (error) throw error;
    vote = data;
  }
  if (!vote || !Number.isInteger(vote.option_index)) return null;
  if ((typeof vote.id !== "string" && typeof vote.id !== "number")
    || (typeof vote.id === "number" && !Number.isSafeInteger(vote.id))
    || !/^[1-9]\d*$/.test(String(vote.id))) throw new Error("Invalid vote management row.");
  const rowId = String(vote.id);
  return {
    rowId,
    viewerVote: {
      optionIndex: vote.option_index, canChangeVote: true, canCancelVote: true,
      managementToken: managementToken(pollId, rowId, actor),
    } satisfies PollViewerVote,
  };
}

export function isVoteManagementTokenValid(supplied: unknown, expected: string) {
  return typeof supplied === "string" && /^[0-9a-f]{64}$/.test(supplied)
    && timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function staleVoteManagementResponse() {
  return NextResponse.json({
    code: "VOTE_MANAGEMENT_CONFLICT",
    error: "투표 상태가 변경되었습니다. 새로고침 후 다시 시도해주세요.",
  }, { status: 409, headers: PRIVATE_VOTE_HEADERS });
}

// Account proof takes precedence; browser participation can manage that same
// existing row across account changes without exposing its account identity.
// This helper only reads the ledger; reconciliation is an explicit POST.
export async function getPollViewerVote(
  client: ReturnType<typeof getSupabaseMutationClient>,
  pollId: string,
  actor: PollVoteActor,
  legacyVoterId = "",
): Promise<PollViewerVote | null> {
  if (!actor.viewerVerified) return null;
  const managed = await getPollVoteManagement(client, pollId, actor);
  if (managed) return managed.viewerVote;
  if (legacyVoterId) {
    const { data: legacyVote, error } = await client.from("poll_votes")
      .select("option_index").eq("poll_id", pollId).eq("voter_id", legacyVoterId)
      .is("user_id", null).is("guest_id_hash", null).maybeSingle();
    if (error) throw error;
    if (legacyVote && Number.isInteger(legacyVote.option_index)) {
      // Legacy header proof can restore results, but mutation requires the
      // existing safe claim flow to bind a verified account or browser proof.
      return { optionIndex: legacyVote.option_index, canChangeVote: false, canCancelVote: false };
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
      && /(?:(?:cast|change|claim)_(?:authenticated|guest)|(?:change|cancel)_managed)_poll_vote/.test(message))
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
