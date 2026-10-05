import "server-only";
import { NextResponse } from "next/server";

export const PRIVATE_VOTE_HEADERS = { "Cache-Control": "private, no-store" };

export function isAccountVotingMigrationMissing(error: unknown) {
  const record = error && typeof error === "object"
    ? error as { code?: string; message?: string }
    : {};
  const message = record.message ?? "";
  return ((record.code === "PGRST202" || record.code === "42883")
      && /(?:cast|change|claim)_authenticated_poll_vote/.test(message))
    || ((record.code === "42703" || record.code === "PGRST204")
      && message.includes("user_id"))
    || ((record.code === "42P01" || record.code === "PGRST205")
      && message.includes("poll_votes"));
}

export function accountVotingMigrationResponse() {
  return NextResponse.json(
    {
      code: "ACCOUNT_VOTING_MIGRATION_REQUIRED",
      error: "계정 투표 기능을 준비 중입니다. 잠시 후 다시 시도해주세요.",
    },
    { status: 503, headers: PRIVATE_VOTE_HEADERS },
  );
}

export function withPrivateVoteHeaders<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", PRIVATE_VOTE_HEADERS["Cache-Control"]);
  return response;
}
