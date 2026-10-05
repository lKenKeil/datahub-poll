export const VOTER_ID_STORAGE_KEY = "dh_voter_id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidVoterId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// Read-only compatibility for historical anonymous votes. New account votes
// never create or use a browser ID as their voting identity.
export function getStoredLegacyVoterId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(VOTER_ID_STORAGE_KEY)?.trim().toLowerCase();
    return isValidVoterId(value) ? value : null;
  } catch {
    return null;
  }
}
