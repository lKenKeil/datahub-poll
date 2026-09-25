export const POLL_OWNER_TOKEN_STORAGE_PREFIX = "dh_poll_owner_token:";

export function getPollOwnerTokenStorageKey(pollId: string) {
  return `${POLL_OWNER_TOKEN_STORAGE_PREFIX}${pollId}`;
}

export function storePollOwnerToken(pollId: string, ownerToken: string) {
  const storageKey = getPollOwnerTokenStorageKey(pollId);
  localStorage.setItem(storageKey, ownerToken);

  if (localStorage.getItem(storageKey) !== ownerToken) {
    throw new Error("Owner token storage verification failed.");
  }
}
