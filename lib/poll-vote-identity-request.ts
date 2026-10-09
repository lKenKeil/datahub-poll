'use client';

let pendingRequest: Promise<Response> | null = null;

export function isPollVoteIdentityReady(status: unknown, signedIn: boolean): boolean {
  return status === (signedIn ? 'account' : 'guest');
}

export async function claimPollVoteIdentity(pollId: string, legacyVoterId: string, signedIn: boolean): Promise<boolean> {
  try {
    const response = await fetchPollVoteIdentity(`/api/polls/${pollId}/vote/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacyVoterId ? { voterId: legacyVoterId } : {}),
    });
    if (!response.ok) return false;
    const json = await response.json() as { mode?: unknown; viewerIdentityStatus?: unknown };
    // HTTP 200 is not enough: the server may still see guest cookies while
    // the browser is hydrating a newly signed-in account (or the reverse).
    return json.mode === 'rpc' && isPollVoteIdentityReady(json.viewerIdentityStatus, signedIn);
  } catch {
    return false;
  }
}

// Initial viewer/claim responses may establish an HttpOnly guest cookie.
// Serialize them across detail-page lifecycles so a late bootstrap response
// cannot replace the browser identity already used by a newer request.
export function fetchPollVoteIdentity(input: string, init?: RequestInit): Promise<Response> {
  const previous = pendingRequest;
  const request = (async () => {
    if (previous) await previous.catch(() => undefined);
    return fetch(input, init);
  })();
  pendingRequest = request;
  const clearPending = () => {
    if (pendingRequest === request) pendingRequest = null;
  };
  void request.then(clearPending, clearPending);
  return request;
}
