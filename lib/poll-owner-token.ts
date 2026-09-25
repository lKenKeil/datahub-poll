import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const OWNER_TOKEN_BYTES = 32;
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OWNER_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export type PollOwnerCredential = {
  token: string;
  hash: string;
};

export function isValidPollOwnerToken(token: unknown): token is string {
  return typeof token === "string" && OWNER_TOKEN_PATTERN.test(token);
}

export function hashPollOwnerToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPollOwnerCredential(): PollOwnerCredential {
  const token = randomBytes(OWNER_TOKEN_BYTES).toString("base64url");
  return {
    token,
    hash: hashPollOwnerToken(token),
  };
}

export function verifyPollOwnerToken(token: unknown, expectedHash: unknown) {
  if (
    !isValidPollOwnerToken(token)
    || typeof expectedHash !== "string"
    || !OWNER_TOKEN_HASH_PATTERN.test(expectedHash)
  ) {
    return false;
  }

  const actualHashBuffer = Buffer.from(hashPollOwnerToken(token), "hex");
  const expectedHashBuffer = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actualHashBuffer, expectedHashBuffer);
}
